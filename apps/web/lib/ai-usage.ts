import { prisma } from "@octopus/db";
import { calcCost, getModelPricing } from "./cost";
import { deductCredits } from "./credits";

type LogAiUsageParams = {
  // ollama / local run on user infra → zero platform cost. grok / openrouter
  // are BYOK like openai. mock / mock-fail are test doubles.
  provider:
    | "anthropic"
    | "openai"
    | "google"
    | "cohere"
    | "ollama"
    | "local"
    | "grok"
    | "openrouter"
    | "mock"
    | "mock-fail";
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
      // ollama / local run on user infra (never bills platform);
      // mock / mock-fail are test doubles (also zero-cost).
      params.provider === "ollama" ||
      params.provider === "local" ||
      params.provider === "mock" ||
      params.provider === "mock-fail";

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
        organizationId: params.organizationId,
      },
    });

    // Only deduct credits for orgs without their own API key
    if (!hasOwnKey) {
      const pricing = await getModelPricing();
      const cost = calcCost(
        pricing,
        params.model,
        params.inputTokens,
        params.outputTokens,
        params.cacheReadTokens ?? 0,
        params.cacheWriteTokens ?? 0,
      );

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
