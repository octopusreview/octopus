import { describe, it, expect, mock, beforeEach } from "bun:test";

mock.module("server-only", () => ({}));

// getOrgSpendLimitStatus reaches prisma + the review-model/provider resolvers.
// Mock those before importing cost.ts. Mock fns close over these mutable vars so
// each test can set the org, the effective review provider, and monthly spend.
type OrgRow = {
  type: number;
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  googleApiKey: string | null;
  cohereApiKey: string | null;
  grokApiKey: string | null;
  openrouterApiKey: string | null;
  claudeCodeApiKey: string | null;
  claudeCodeAuthMode: string | null;
  monthlySpendLimitUsd: number | null;
  creditBalance: number;
  freeCreditBalance: number;
};

let org: OrgRow;
let provider = "anthropic";
let providerThrows = false;
let usageDebitTotal: number | null = null;
const creditTransactionAggregate = mock(async (_args: unknown) => ({
  _sum: { amount: usageDebitTotal },
}));

function baseOrg(overrides: Partial<OrgRow> = {}): OrgRow {
  return {
    type: 1, // standard (credit-gated)
    anthropicApiKey: null,
    openaiApiKey: null,
    googleApiKey: null,
    cohereApiKey: null,
    grokApiKey: null,
    openrouterApiKey: null,
    claudeCodeApiKey: null,
    claudeCodeAuthMode: null,
    monthlySpendLimitUsd: null,
    creditBalance: 0,
    freeCreditBalance: 0,
    ...overrides,
  };
}

mock.module("@octopus/db", () => ({
  prisma: {
    organization: { findUnique: mock(async () => org) },
    creditTransaction: { aggregate: creditTransactionAggregate },
    // getModelPricing falls back to FALLBACK_PRICING when the DB list is empty.
    availableModel: { findMany: mock(async () => []), findFirst: mock(async () => null) },
  },
}));
mock.module("@/lib/ai-client", () => ({
  getReviewModel: mock(async () => "claude-opus-4-8"),
}));
mock.module("@/lib/ai-router", () => ({
  getProviderForModel: mock(async () => {
    if (providerThrows) throw new Error("provider resolution boom");
    return provider;
  }),
}));

const { getOrgMonthlySpend, getOrgSpendLimitStatus } = await import("@/lib/cost");

beforeEach(() => {
  org = baseOrg();
  provider = "anthropic";
  providerThrows = false;
  usageDebitTotal = null;
  creditTransactionAggregate.mockClear();
});

describe("getOrgSpendLimitStatus — BYOK admission (B4)", () => {
  it("exempts an org that has its own key for the provider it actually uses", async () => {
    org = baseOrg({ anthropicApiKey: "sk-ant", creditBalance: 0, freeCreditBalance: 0 });
    provider = "anthropic";
    expect(await getOrgSpendLimitStatus("o")).toEqual({ blocked: false });
  });

  it("does NOT exempt when the org's only key is for a provider it does not use", async () => {
    org = baseOrg({ openaiApiKey: "sk-oai", creditBalance: 0, freeCreditBalance: 0 });
    provider = "anthropic"; // review uses anthropic, but org only brought an openai key
    expect(await getOrgSpendLimitStatus("o")).toEqual({ blocked: true, reason: "no_credits" });
  });

  it("exempts operator-infra providers (ollama) regardless of keys", async () => {
    org = baseOrg({ creditBalance: 0, freeCreditBalance: 0 });
    provider = "ollama";
    expect(await getOrgSpendLimitStatus("o")).toEqual({ blocked: false });
  });

  it("falls back to the strict all-provider check when provider resolution throws", async () => {
    providerThrows = true;
    // Has all three keys → still exempt via fallback.
    org = baseOrg({ anthropicApiKey: "a", openaiApiKey: "o", googleApiKey: "g", creditBalance: 0 });
    expect(await getOrgSpendLimitStatus("o")).toEqual({ blocked: false });

    // Missing a key + no credits → blocked (fallback is strict).
    providerThrows = true;
    org = baseOrg({ anthropicApiKey: "a", creditBalance: 0, freeCreditBalance: 0 });
    expect(await getOrgSpendLimitStatus("o")).toEqual({ blocked: true, reason: "no_credits" });
  });
});

describe("getOrgSpendLimitStatus — credit vs cap discrimination (B1 source of truth)", () => {
  it("returns reason=no_credits when total balance is <= 0 and no BYOK key", async () => {
    org = baseOrg({ creditBalance: 0, freeCreditBalance: 0 });
    expect(await getOrgSpendLimitStatus("o")).toEqual({ blocked: true, reason: "no_credits" });
  });

  it("is not blocked with a positive balance and no monthly cap", async () => {
    org = baseOrg({ creditBalance: 10, freeCreditBalance: 0 });
    expect(await getOrgSpendLimitStatus("o")).toEqual({ blocked: false });
  });

  it("returns reason=spend_limit when a positive-balance org exceeds its monthly cap", async () => {
    org = baseOrg({ creditBalance: 100, freeCreditBalance: 0, monthlySpendLimitUsd: 1 });
    usageDebitTotal = -30;
    const res = await getOrgSpendLimitStatus("o");
    expect(res.blocked).toBe(true);
    expect(res).toMatchObject({ reason: "spend_limit" });
  });

  it("uses committed usage debits for current-month spend", async () => {
    org = baseOrg({ creditBalance: 100, freeCreditBalance: 0, monthlySpendLimitUsd: 4 });
    usageDebitTotal = -4.25;

    expect(await getOrgSpendLimitStatus("o")).toEqual({
      blocked: true,
      reason: "spend_limit",
      limitUsd: 4,
    });
  });

  it("exempts community orgs from the credit gate entirely", async () => {
    org = baseOrg({ type: 2, creditBalance: 0, freeCreditBalance: 0 });
    expect(await getOrgSpendLimitStatus("o")).toEqual({ blocked: false });
  });
});

describe("getOrgMonthlySpend — committed ledger source", () => {
  it("sums only non-refund usage debits inside the current UTC month", async () => {
    usageDebitTotal = -12.3456;

    expect(await getOrgMonthlySpend("org_1")).toBe(12.3456);

    const query = creditTransactionAggregate.mock.calls[0]?.[0] as {
      where: {
        organizationId: string;
        type: string;
        stripeRefundId: null;
        amount: { lt: number };
        createdAt: { gte: Date; lt: Date };
      };
    };
    expect(query.where).toMatchObject({
      organizationId: "org_1",
      type: "usage",
      stripeRefundId: null,
      amount: { lt: 0 },
    });
    expect(query.where.createdAt.gte.getUTCDate()).toBe(1);
    expect(query.where.createdAt.gte.getUTCHours()).toBe(0);
    expect(query.where.createdAt.lt.getUTCDate()).toBe(1);
    expect(query.where.createdAt.lt.getTime()).toBeGreaterThan(
      query.where.createdAt.gte.getTime(),
    );
  });

  it("returns zero when no committed usage debit exists", async () => {
    expect(await getOrgMonthlySpend("org_1")).toBe(0);
  });
});
