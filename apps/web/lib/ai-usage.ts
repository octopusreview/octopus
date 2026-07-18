import { prisma } from "@octopus/db";
import { calcCost, getModelPricing } from "./cost";
import { deductCredits } from "./credits";

type LogAiUsageParams = {
  provider: "anthropic" | "openai" | "google" | "cohere" | "grok" | "openrouter" | "ollama" | "local" | "acp" | "opencode" | "claude-code" | "mock" | "mock-fail";
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  organizationId: string;
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
        claudeCodeApiKey: true,
        claudeCodeAuthMode: true,
      },
    });

    if (!org) {
      console.error("[ai-usage] Organization not found, skipping usage record:", params.organizationId);
      return;
    }

    const hasOwnKey =
      (params.provider === "anthropic" && !!org.anthropicApiKey) ||
      (params.provider === "openai" && !!org.openaiApiKey) ||
      (params.provider === "google" && !!org.googleApiKey) ||
      (params.provider === "cohere" && !!org.cohereApiKey) ||
      (params.provider === "grok" && !!org.grokApiKey) ||
      (params.provider === "openrouter" && !!org.openrouterApiKey) ||
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
      params.provider === "mock-fail";

    // Compute the platform charge up front so we can snapshot it on the row —
    // recording the cost as-charged means historical margin no longer drifts
    // when model prices change later. Own-key usage is never charged (null).
    let cost = 0;
    if (!hasOwnKey) {
      const pricing = await getModelPricing();
      cost = calcCost(
        pricing,
        params.model,
        params.inputTokens,
        params.outputTokens,
        params.cacheReadTokens ?? 0,
        params.cacheWriteTokens ?? 0,
      );
    }

    await prisma.aiUsage.create({
      data: {
        provider: params.provider,
        model: params.model,
        operation: params.operation,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        cacheReadTokens: params.cacheReadTokens ?? 0,
        cacheWriteTokens: params.cacheWriteTokens ?? 0,
        usedOwnKey: hasOwnKey,
        chargedCostUsd: hasOwnKey ? null : cost,
        organizationId: params.organizationId,
      },
    });

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
    }
  } catch (err) {
    console.error("[ai-usage] Failed to log:", err);
  }
}
