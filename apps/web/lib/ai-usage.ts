import "server-only";
import { prisma } from "@octopus/db";
import { calcCost, getModelPricing } from "./cost";
import { deductCredits } from "./credits";
import { AiProviderFailure, safeErrorDetails } from "./provider-failure";
import type { CacheTtl } from "./providers/system-cache";

type LogAiUsageParams = {
  usedOwnKey?: boolean;
  provider: "anthropic" | "openai" | "google" | "cohere" | "grok" | "openrouter" | "alibaba" | "ollama" | "local" | "acp" | "opencode" | "claude-code" | "mock" | "mock-fail";
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheWriteTtl?: CacheTtl;
  organizationId: string;
  /** Debit at most once per key: a second write with the same key records and charges nothing. */
  chargeKey?: string;
  /** A failed provider attempt: tokens are unknown (stored as 0) and the customer is never charged. */
  usageUnknown?: boolean;
};

export async function logAiUsage(params: LogAiUsageParams): Promise<void> {
  try {
    // Determine key ownership before recording usage
    const org = await prisma.organization.findUnique({
      where: { id: params.organizationId },
      select: {
        anthropicApiKey: true,
        openaiApiKey: true,
        cohereApiKey: true,
        googleApiKey: true,
        grokApiKey: true,
        openrouterApiKey: true,
        alibabaApiKey: true,
        claudeCodeApiKey: true,
        claudeCodeAuthMode: true,
      },
    });

    if (!org) {
      console.error("[ai-usage] Organization not found, skipping usage record:", params.organizationId);
      return;
    }

    const hasOwnKey = params.usedOwnKey ?? (
      (params.provider === "anthropic" && !!org.anthropicApiKey) ||
      (params.provider === "openai" && !!org.openaiApiKey) ||
      (params.provider === "google" && !!org.googleApiKey) ||
      (params.provider === "cohere" && !!org.cohereApiKey) ||
      (params.provider === "grok" && !!org.grokApiKey) ||
      (params.provider === "openrouter" && !!org.openrouterApiKey) ||
      (params.provider === "alibaba" && !!org.alibabaApiKey) ||
      // Claude Code: api-key mode bills against the org key; subscription mode
      // shells out to the local `claude` CLI (the user's own auth) — own-key.
      (params.provider === "claude-code" &&
        (!!org.claudeCodeApiKey || org.claudeCodeAuthMode === "subscription")) ||
      // Ollama / ACPX / OpenCode run on operator-configured infra/gateways and
      // the local-agent bridge runs on the user's laptop — never bill platform.
      params.provider === "ollama" ||
      params.provider === "local" ||
      params.provider === "acp" ||
      params.provider === "opencode" ||
      // Test doubles — zero cost.
      params.provider === "mock" ||
      params.provider === "mock-fail");

    // Compute the platform charge up front (needed for both the deduction and
    // the cost snapshot). Own-key usage is never charged.
    let cost = 0;
    if (!hasOwnKey && !params.usageUnknown) {
      const pricing = await getModelPricing();
      cost = calcCost(
        pricing,
        params.model,
        params.inputTokens,
        params.outputTokens,
        params.cacheReadTokens ?? 0,
        params.cacheWriteTokens ?? 0,
        params.provider,
        params.cacheWriteTtl,
      );
    }

    // Record the usage row FIRST (usage happened regardless of billing), with
    // chargedCostUsd left null. We stamp the snapshot only AFTER a successful
    // deduction, so the field always reflects what we actually charged — a
    // failed deduction leaves it null ("usage served, charged nothing"), never
    // a phantom charge. Recording the snapshot means historical margin no
    // longer drifts when model prices change later.
    const usage = await prisma.aiUsage.create({
      data: {
        ...(params.chargeKey ? { chargeKey: params.chargeKey } : {}),
        ...(params.usageUnknown ? { usageUnknown: true } : {}),
        provider: params.provider,
        model: params.model,
        operation: params.operation,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        cacheReadTokens: params.cacheReadTokens ?? 0,
        cacheWriteTokens: params.cacheWriteTokens ?? 0,
        usedOwnKey: hasOwnKey,
        organizationId: params.organizationId,
      },
    }).catch((error: unknown) => {
      // The unique key makes a redelivered or repeated charge a no-op, including under concurrency.
      if (params.chargeKey && (error as { code?: string } | null)?.code === "P2002") return null;
      throw error;
    });
    if (!usage) { console.log(`[ai-usage] ${params.operation} already charged for this request; no second debit`); return; }
    if (params.usageUnknown) return;

    // Only deduct credits for orgs without their own API key
    if (!hasOwnKey) {
      console.log(
        `[ai-usage] ${params.operation} model=${params.model} cost=$${cost.toFixed(6)} org=${params.organizationId} hasOwnKey=${hasOwnKey}`,
      );

      if (cost > 0) {
        await deductCredits(
          params.organizationId,
          cost,
          `${params.operation} — ${params.model}`,
        );
      }

      // Deduction committed (or was $0) — now stamp the cost snapshot.
      await prisma.aiUsage.update({
        where: { id: usage.id },
        data: { chargedCostUsd: cost },
      });
    }
  } catch (err) {
    console.error("[ai-usage] Failed to log:", safeErrorDetails(err instanceof AiProviderFailure ? err.details : err));
  }
}
