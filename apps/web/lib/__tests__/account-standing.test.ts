import { beforeEach, describe, expect, it, mock } from "bun:test";

import { ORG_TYPE } from "@/lib/org-types";

// Account-standing gate (signup-farm control, issue #788): held accounts —
// shared device fingerprint or welcome-risk hold/block band — with no real
// product signal (connected repo, Stripe customer, purchase, FRIENDLY type,
// BYOK key, paid plan tier) cannot mint or use org API tokens. @octopus/db
// mocked (same approach as org-create.test.ts).

type OrgRow = {
  id: string;
  stripeCustomerId: string | null;
  welcomeRiskScore: number | null;
  type: number;
  planTier: string;
  anthropicApiKey: string | null;
};

const org = (overrides: Partial<OrgRow> = {}): OrgRow => ({
  id: "org1",
  stripeCustomerId: null,
  welcomeRiskScore: null,
  type: ORG_TYPE.STANDARD,
  planTier: "free",
  anthropicApiKey: null,
  ...overrides,
});

let orgRow: OrgRow | null;
let repoRow: { id: string; externalId: string } | null;
let purchaseRow: { id: string } | null;
let deviceRows: { fingerprint: string }[];
let sharedGroups: { fingerprint: string; _count: { fingerprint: number } }[];
let apiTokenRow: Record<string, unknown> | null;

const client = {
  organization: { findUnique: mock(() => Promise.resolve(orgRow)) },
  repository: {
    // Honors the one filter under test: NOT externalId startsWith "cli:".
    findFirst: mock(
      (args?: { where?: { NOT?: { externalId?: { startsWith?: string } } } }) => {
        const excluded = args?.where?.NOT?.externalId?.startsWith;
        if (repoRow && excluded && repoRow.externalId.startsWith(excluded)) {
          return Promise.resolve(null);
        }
        return Promise.resolve(repoRow);
      },
    ),
  },
  creditTransaction: { findFirst: mock(() => Promise.resolve(purchaseRow)) },
  userDevice: {
    findMany: mock(() => Promise.resolve(deviceRows)),
    groupBy: mock(() => Promise.resolve(sharedGroups)),
  },
  orgApiToken: {
    findUnique: mock(() => Promise.resolve(apiTokenRow)),
    update: mock(() => Promise.resolve({})),
  },
};

mock.module("@octopus/db", () => ({ prisma: client }));

const { getAccountStanding, ACCOUNT_HOLD_MESSAGE } = await import(
  "@/lib/account-standing"
);
const { authenticateApiToken } = await import("@/lib/api-auth");

const FP = "a".repeat(64);

beforeEach(() => {
  // Default: clean account — no product signal, no risk, no shared devices.
  orgRow = org();
  repoRow = null;
  purchaseRow = null;
  deviceRows = [];
  sharedGroups = [];
  apiTokenRow = null;
});

describe("getAccountStanding", () => {
  it("holds when the user's fingerprint is shared at/above the threshold", async () => {
    deviceRows = [{ fingerprint: FP }];
    sharedGroups = [{ fingerprint: FP, _count: { fingerprint: 1641 } }];
    const standing = await getAccountStanding({ userId: "u1", orgId: "org1" });
    expect(standing.held).toBe(true);
    expect(standing.reasons.join(",")).toContain("shared_fingerprint");
  });

  it("holds when the org's welcome risk score is in the hold band", async () => {
    orgRow = org({ welcomeRiskScore: 50 });
    const standing = await getAccountStanding({ userId: "u1", orgId: "org1" });
    expect(standing.held).toBe(true);
    expect(standing.reasons).toContain("welcome_risk_hold");
  });

  it("does NOT hold when the org has a repository, even with risk signals", async () => {
    orgRow = org({ welcomeRiskScore: 50 });
    deviceRows = [{ fingerprint: FP }];
    sharedGroups = [{ fingerprint: FP, _count: { fingerprint: 1641 } }];
    repoRow = { id: "repo1", externalId: "12345" };
    const standing = await getAccountStanding({ userId: "u1", orgId: "org1" });
    expect(standing.held).toBe(false);
    expect(standing.reasons).toEqual([]);
  });

  it("does NOT count a CLI-created repo (externalId cli:*) as a product signal", async () => {
    // index-local.ts creates such rows on a token-authed call — self-mintable,
    // so a farm could plant its own exemption. Must NOT clear a hold.
    orgRow = org({ welcomeRiskScore: 50 });
    repoRow = { id: "repo1", externalId: "cli:github:farm/planted" };
    const standing = await getAccountStanding({ userId: "u1", orgId: "org1" });
    expect(standing.held).toBe(true);
    expect(standing.reasons).toContain("welcome_risk_hold");
  });

  it("does NOT hold when the org has a purchase, even with risk signals", async () => {
    orgRow = org({ welcomeRiskScore: 50 });
    deviceRows = [{ fingerprint: FP }];
    sharedGroups = [{ fingerprint: FP, _count: { fingerprint: 1641 } }];
    purchaseRow = { id: "tx1" };
    const standing = await getAccountStanding({ userId: "u1", orgId: "org1" });
    expect(standing.held).toBe(false);
  });

  it("does NOT hold when the org has a Stripe customer", async () => {
    orgRow = org({ stripeCustomerId: "cus_123", welcomeRiskScore: 50 });
    const standing = await getAccountStanding({ userId: "u1", orgId: "org1" });
    expect(standing.held).toBe(false);
  });

  it("does NOT hold a FRIENDLY (comped) org", async () => {
    orgRow = org({ welcomeRiskScore: 50, type: ORG_TYPE.FRIENDLY });
    const standing = await getAccountStanding({ userId: "u1", orgId: "org1" });
    expect(standing.held).toBe(false);
  });

  it("does NOT hold an org running on its own provider key (BYOK)", async () => {
    orgRow = org({ welcomeRiskScore: 50, anthropicApiKey: "sk-ant-own-key" });
    const standing = await getAccountStanding({ userId: "u1", orgId: "org1" });
    expect(standing.held).toBe(false);
  });

  it("does NOT hold an org on a paid plan tier", async () => {
    orgRow = org({ welcomeRiskScore: 50, planTier: "pro" });
    const standing = await getAccountStanding({ userId: "u1", orgId: "org1" });
    expect(standing.held).toBe(false);
  });

  it("does NOT hold a clean account", async () => {
    const standing = await getAccountStanding({ userId: "u1", orgId: "org1" });
    expect(standing.held).toBe(false);
    expect(standing.reasons).toEqual([]);
  });
});

describe("authenticateApiToken account-standing gate", () => {
  const request = () =>
    new Request("http://localhost/api/cli/chat", {
      headers: { authorization: "Bearer oct_0123456789abcdef" },
    });

  it("rejects a token whose org is held with a 403 and the hold message", async () => {
    apiTokenRow = {
      id: "tok1",
      expiresAt: null,
      organization: {
        ...org({ welcomeRiskScore: 50 }),
        bannedAt: null,
        deletedAt: null,
      },
      createdBy: { id: "u1" },
    };
    const result = await authenticateApiToken(request());
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe(ACCOUNT_HOLD_MESSAGE);
  });

  it("still authenticates a token whose org is not held", async () => {
    apiTokenRow = {
      id: "tok1",
      expiresAt: null,
      organization: {
        ...org(),
        bannedAt: null,
        deletedAt: null,
      },
      createdBy: { id: "u1" },
    };
    const result = await authenticateApiToken(request());
    expect(result).not.toBeInstanceOf(Response);
    expect(result && !(result instanceof Response) && result.org.id).toBe("org1");
  });
});
