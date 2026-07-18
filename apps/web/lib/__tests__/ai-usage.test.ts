import { beforeEach, describe, expect, it, mock } from "bun:test";

type CreatedUsage = { usedOwnKey: boolean; chargedCostUsd: number | null; model: string };

let createdUsage: CreatedUsage[];
let deducted: Array<{ orgId: string; amount: number }>;
let orgRow: Record<string, unknown> | null;

mock.module("@octopus/db", () => ({
  prisma: {
    organization: {
      findUnique: () => Promise.resolve(orgRow),
    },
    aiUsage: {
      create: ({ data }: { data: CreatedUsage }) => {
        createdUsage.push(data);
        return Promise.resolve(data);
      },
    },
  },
}));

// Fixed pricing so the charged cost is deterministic: $10/1M input tokens.
mock.module("@/lib/cost", () => ({
  getModelPricing: () => Promise.resolve(new Map([["m", { input: 10, output: 10 }]])),
  calcCost: (
    _p: unknown,
    _model: string,
    input: number,
    output: number,
  ) => ((input * 10 + output * 10) / 1_000_000) * 1.2,
}));

mock.module("@/lib/credits", () => ({
  deductCredits: (orgId: string, amount: number) => {
    deducted.push({ orgId, amount });
    return Promise.resolve();
  },
}));

const { logAiUsage } = await import("@/lib/ai-usage");

beforeEach(() => {
  createdUsage = [];
  deducted = [];
  orgRow = {
    anthropicApiKey: null,
    openaiApiKey: null,
    cohereApiKey: null,
    googleApiKey: null,
    grokApiKey: null,
    openrouterApiKey: null,
    claudeCodeApiKey: null,
    claudeCodeAuthMode: null,
  };
});

describe("logAiUsage cost snapshot", () => {
  it("stores chargedCostUsd = deducted cost for platform-key usage", async () => {
    await logAiUsage({
      provider: "anthropic",
      model: "m",
      operation: "review",
      inputTokens: 1_000_000,
      outputTokens: 0,
      organizationId: "org_1",
    });

    // 1M input × $10 /1M × 1.2 markup = $12.
    expect(createdUsage).toHaveLength(1);
    expect(createdUsage[0].usedOwnKey).toBe(false);
    expect(createdUsage[0].chargedCostUsd).toBeCloseTo(12, 6);
    expect(deducted).toEqual([{ orgId: "org_1", amount: 12 }]);
  });

  it("stores null chargedCostUsd for own-key usage and never deducts", async () => {
    orgRow = { ...(orgRow as object), anthropicApiKey: "sk-ant-user" };

    await logAiUsage({
      provider: "anthropic",
      model: "m",
      operation: "review",
      inputTokens: 1_000_000,
      outputTokens: 0,
      organizationId: "org_1",
    });

    expect(createdUsage[0].usedOwnKey).toBe(true);
    expect(createdUsage[0].chargedCostUsd).toBeNull();
    expect(deducted).toEqual([]);
  });
});
