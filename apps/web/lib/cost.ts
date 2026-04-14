import { prisma } from "@octopus/db";

type ModelPricing = { input: number; output: number };

// In-memory cache for model pricing (5 min TTL)
let pricingCache: Map<string, ModelPricing> | null = null;
let pricingCacheTime = 0;
const PRICING_CACHE_TTL = 5 * 60 * 1000;

// Fallback pricing for models not yet in DB
const FALLBACK_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-6-20250619": { input: 15, output: 75 },
  "claude-sonnet-4-6-20250619": { input: 3, output: 15 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-opus-4-20250514": { input: 15, output: 75 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.15, output: 0.6 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
  "rerank-v3.5": { input: 2000.0, output: 0 },
};

export async function getModelPricing(): Promise<Map<string, ModelPricing>> {
  if (pricingCache && Date.now() - pricingCacheTime < PRICING_CACHE_TTL) {
    return pricingCache;
  }

  const models = await prisma.availableModel.findMany({
    select: { modelId: true, inputPrice: true, outputPrice: true },
  });

  const map = new Map<string, ModelPricing>();
  for (const m of models) {
    map.set(m.modelId, { input: m.inputPrice, output: m.outputPrice });
  }

  // Merge fallback for models not in DB
  for (const [k, v] of Object.entries(FALLBACK_PRICING)) {
    if (!map.has(k)) map.set(k, v);
  }

  pricingCache = map;
  pricingCacheTime = Date.now();
  return map;
}

export function calcCost(
  pricing: Map<string, ModelPricing>,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
): number {
  const p = pricing.get(model);
  if (!p) return 0;
  const PLATFORM_MARKUP = 1.2; // 20% markup
  const plainInput = Math.max(inputTokens - cacheReadTokens - cacheWriteTokens, 0);
  const baseCost =
    (plainInput * p.input +
      cacheWriteTokens * p.input * 1.25 +
      cacheReadTokens * p.input * 0.1 +
      outputTokens * p.output) /
    1_000_000;
  return baseCost * PLATFORM_MARKUP;
}

export async function getOrgMonthlySpend(orgId: string): Promise<number> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const usages = await prisma.aiUsage.groupBy({
    by: ["model"],
    where: {
      organizationId: orgId,
      createdAt: { gte: monthStart },
      usedOwnKey: false,
    },
    _sum: {
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheWriteTokens: true,
    },
  });

  const pricing = await getModelPricing();
  let total = 0;

  for (const row of usages) {
    total += calcCost(
      pricing,
      row.model,
      row._sum?.inputTokens ?? 0,
      row._sum?.outputTokens ?? 0,
      row._sum?.cacheReadTokens ?? 0,
      row._sum?.cacheWriteTokens ?? 0,
    );
  }

  return total;
}

export type SpendLimitResult =
  | { blocked: false }
  | { blocked: true; reason: "no_credits" }
  | { blocked: true; reason: "spend_limit"; limitUsd: number };

export async function getOrgSpendLimitStatus(orgId: string): Promise<SpendLimitResult> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      anthropicApiKey: true,
      openaiApiKey: true,
      googleApiKey: true,
      monthlySpendLimitUsd: true,
      creditBalance: true,
      freeCreditBalance: true,
    },
  });

  if (!org) return { blocked: false };

  // Orgs with their own keys for all LLM providers have no platform limit
  if (org.anthropicApiKey && org.openaiApiKey && org.googleApiKey) return { blocked: false };

  // Check credit balance — if both free and purchased are <= 0, block usage
  const totalCredits = Number(org.creditBalance) + Number(org.freeCreditBalance);
  if (totalCredits <= 0) return { blocked: true, reason: "no_credits" };

  // null limit means unlimited
  if (org.monthlySpendLimitUsd == null) return { blocked: false };

  const spend = await getOrgMonthlySpend(orgId);
  if (spend >= org.monthlySpendLimitUsd) {
    return { blocked: true, reason: "spend_limit", limitUsd: org.monthlySpendLimitUsd };
  }

  return { blocked: false };
}

export async function isOrgOverSpendLimit(orgId: string): Promise<boolean> {
  const status = await getOrgSpendLimitStatus(orgId);
  return status.blocked;
}

export function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
