import "server-only";

import { prisma } from "@octopus/db";
import { ORG_TYPE } from "@/lib/org-types";
import { getUtcMonthBounds } from "@/lib/billing-period";
// Keep the review-model/provider resolvers lazy so pure pricing helpers do not
// initialize the provider stack and its configuration during module startup.

type ModelPricing = { input: number; output: number };

// In-memory cache for model pricing (5 min TTL)
let pricingCache: Map<string, ModelPricing> | null = null;
let pricingCacheTime = 0;
const PRICING_CACHE_TTL = 5 * 60 * 1000;

// Fallback pricing for models not yet in DB
const FALLBACK_PRICING: Record<string, ModelPricing> = {
  // Claude Fable 5 is the Claude 5 frontier model; offered as the top "max"
  // review tier (2x Opus 5).
  "claude-fable-5": { input: 10, output: 50 },
  // Anthropic's published API id for Opus 5 is undated (no dated canonical id
  // was released); the key must match the id used in calls for exact-key lookup.
  "claude-opus-5": { input: 5, output: 25 },
  // Opus 4.8 is the current Anthropic Opus tier ($5/$25) and replaces Opus 4.6
  // in the offered catalogue. The dated 4.6 key is retained below so any usage
  // already logged under it still prices (never silently bills $0).
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-6-20250619": { input: 15, output: 75 },
  "claude-sonnet-4-6-20250619": { input: 3, output: 15 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-opus-4-20250514": { input: 15, output: 75 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.15, output: 0.6 },
  "gpt-5.3-codex": { input: 1.75, output: 14 },
  // Claude Code is subscription-billed (not per-token), so platform price is 0.
  "claude-code:sonnet": { input: 0, output: 0 },
  // OpenRouter Hermes 3 8B — estimate (~$0.10/$0.15 per 1M in/out).
  "openrouter/nousresearch/hermes-3-llama-3.1-8b": { input: 0.1, output: 0.15 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
  "rerank-v3.5": { input: 2000.0, output: 0 },
};

/** Models that always have pricing (independent of the DB). Lets a router
 *  assert every model it can emit is billable, so a downshift can never bill $0. */
export function fallbackPricedModels(): string[] {
  return Object.keys(FALLBACK_PRICING);
}

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

// Multiplier applied to provider list price when charging credits.
// Overridable per deployment via PLATFORM_MARKUP; guarded so a bad value
// can never zero out or invert billing.
const rawMarkup = process.env.PLATFORM_MARKUP;
const parsedMarkup = Number(rawMarkup);
const markupValid = Number.isFinite(parsedMarkup) && parsedMarkup >= 1;
if (rawMarkup !== undefined && rawMarkup !== "" && !markupValid) {
  console.warn(
    `Invalid PLATFORM_MARKUP ${JSON.stringify(rawMarkup)} (must be a number >= 1) — using default 1.2`,
  );
}
export const PLATFORM_MARKUP = markupValid ? parsedMarkup : 1.2;

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
  // Cache-write premium tracks PROMPT_CACHE_TTL (the same env that sets the
  // actual TTL on Anthropic review calls): a 1h cache write costs 2x base input,
  // a 5m write 1.25x. Reviews are the dominant Anthropic path, so this keeps the
  // billed write cost aligned with what Anthropic charges under the active TTL.
  const cacheWriteMultiplier = process.env.PROMPT_CACHE_TTL === "5m" ? 1.25 : 2;
  const plainInput = Math.max(inputTokens - cacheReadTokens - cacheWriteTokens, 0);
  const baseCost =
    (plainInput * p.input +
      cacheWriteTokens * p.input * cacheWriteMultiplier +
      cacheReadTokens * p.input * 0.1 +
      outputTokens * p.output) /
    1_000_000;
  return baseCost * PLATFORM_MARKUP;
}

export async function getOrgMonthlySpend(orgId: string): Promise<number> {
  const { start, end } = getUtcMonthBounds();

  // The credit ledger is the source of truth for spend: a usage row exists
  // only after the balance deduction commits. Refund deductions share the
  // legacy `usage` type, so exclude rows carrying a Stripe refund id.
  const debits = await prisma.creditTransaction.aggregate({
    where: {
      organizationId: orgId,
      type: "usage",
      stripeRefundId: null,
      amount: { lt: 0 },
      createdAt: { gte: start, lt: end },
    },
    _sum: { amount: true },
  });

  return Math.max(0, -Number(debits._sum.amount ?? 0));
}

export type SpendLimitResult =
  | { blocked: false }
  | { blocked: true; reason: "no_credits" }
  | { blocked: true; reason: "spend_limit"; limitUsd: number };

// Whether the org's own key/config covers this provider, so a review on it is
// never platform-billed and the credit gate must not apply. Kept in sync with
// the own-key billing decision in ai-usage.ts:logAiUsage (`hasOwnKey`).
function orgOwnsKeyForProvider(
  org: {
    anthropicApiKey: string | null;
    openaiApiKey: string | null;
    googleApiKey: string | null;
    cohereApiKey: string | null;
    grokApiKey: string | null;
    openrouterApiKey: string | null;
    claudeCodeApiKey: string | null;
    claudeCodeAuthMode: string | null;
  },
  provider: string,
): boolean {
  switch (provider) {
    case "anthropic": return !!org.anthropicApiKey;
    case "openai": return !!org.openaiApiKey;
    case "google": return !!org.googleApiKey;
    case "cohere": return !!org.cohereApiKey;
    case "grok": return !!org.grokApiKey;
    case "openrouter": return !!org.openrouterApiKey;
    case "claude-code":
      return !!org.claudeCodeApiKey || org.claudeCodeAuthMode === "subscription";
    // Operator-infra / local-agent / gateways / test doubles: never platform-billed.
    case "ollama":
    case "local":
    case "acp":
    case "opencode":
    case "mock":
    case "mock-fail":
      return true;
    default:
      return false;
  }
}

export async function getOrgSpendLimitStatus(orgId: string): Promise<SpendLimitResult> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      type: true,
      anthropicApiKey: true,
      openaiApiKey: true,
      googleApiKey: true,
      cohereApiKey: true,
      grokApiKey: true,
      openrouterApiKey: true,
      claudeCodeApiKey: true,
      claudeCodeAuthMode: true,
      monthlySpendLimitUsd: true,
      creditBalance: true,
      freeCreditBalance: true,
    },
  });

  if (!org) return { blocked: false };

  // Community orgs get rate-limited via communityDailyReviewLimit, not credits.
  if (org.type === ORG_TYPE.COMMUNITY) return { blocked: false };

  // BYOK: an org that brings its own key for the provider its reviews ACTUALLY
  // use pays that provider directly, so the platform credit gate doesn't apply.
  // (Previously this required keys for anthropic AND openai AND google at once,
  // so an org that brought only the key for the provider it uses was still
  // wrongly credit-blocked.) On resolution failure, fall back to the old strict
  // all-provider check so the gate never throws and never bills a fully-keyed org.
  try {
    const [{ getReviewModel }, { getProviderForModel }] = await Promise.all([
      import("@/lib/ai-client"),
      import("@/lib/ai-router"),
    ]);
    const provider = await getProviderForModel(await getReviewModel(orgId));
    if (orgOwnsKeyForProvider(org, provider)) return { blocked: false };
  } catch (err) {
    console.error("[cost] spend-gate provider resolution failed; using strict BYOK check:", err);
    if (org.anthropicApiKey && org.openaiApiKey && org.googleApiKey) return { blocked: false };
  }

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

// Balance below which we serialize a platform-billed org's reviews. Metering
// is post-paid, so N reviews admitted at the same instant can each pass the
// balance check and collectively overspend. This bounds that overspend to a
// single review once the balance is nearly gone. Comfortable balances are
// unaffected — concurrency is only capped inside this danger window.
const CONCURRENCY_GUARD_BALANCE_USD = 10;

/**
 * Pure guard decision: serialize when the org is platform-billed (not fully
 * BYOK) AND its balance is in the (0, threshold) danger window. At or below 0
 * the spend-limit check already blocks admission, so the guard only covers the
 * narrow window above it.
 */
export function concurrencyGuardApplies(fullyBYOK: boolean, totalBalanceUsd: number): boolean {
  if (fullyBYOK) return false;
  return totalBalanceUsd > 0 && totalBalanceUsd < CONCURRENCY_GUARD_BALANCE_USD;
}

/** True when an org's reviews should be serialized to prevent concurrent overspend. */
export async function shouldGuardConcurrency(orgId: string): Promise<boolean> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      type: true,
      anthropicApiKey: true,
      openaiApiKey: true,
      googleApiKey: true,
      creditBalance: true,
      freeCreditBalance: true,
    },
  });
  if (!org) return false;
  // Community orgs are rate-limited (communityDailyReviewLimit), not credit-
  // billed — same exemption getOrgSpendLimitStatus applies. No credit spend to
  // serialize.
  if (org.type === ORG_TYPE.COMMUNITY) return false;
  const fullyBYOK = Boolean(org.anthropicApiKey && org.openaiApiKey && org.googleApiKey);
  const total = Number(org.creditBalance) + Number(org.freeCreditBalance);
  return concurrencyGuardApplies(fullyBYOK, total);
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
