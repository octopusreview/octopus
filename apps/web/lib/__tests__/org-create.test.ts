import { beforeEach, describe, expect, it, mock } from "bun:test";

// Integration-ish test of the welcome-bonus gate in createOrgForUser, with
// @octopus/db mocked (same approach as billing.test.ts). Locks the security
// property that a WITHHELD first org still consumes the one-time bonus (stamps
// welcomeGrantedAt), and that delete-recreate / already-granted don't re-grant.

type UserRow = {
  emailVerified: boolean;
  signupIp: string | null;
  welcomeGrantedAt: Date | null;
};

let userRow: UserRow;
let ipPeerCount: number;
let everOwnedCount: number; // hasEverOwnedOrg (no deletedAt filter)
let activeOwnedCount: number; // cap check (deletedAt: null)
let claimCount: number; // updateMany result count
let accountCount: number; // OAuth `accounts` rows for the user
let createdData: Record<string, unknown> | null;
let claimCalled: boolean;
let orgUpdates: Record<string, unknown>[]; // organization.update data payloads
let creditTxCreates: Record<string, unknown>[]; // creditTransaction.create data
let orgWelcomeRiskReason: string | null; // org row read by the deferred path
let bbIntegration: { workspaceSlug: string } | null;
let bbReuseCount: number; // same workspace attached to OTHER orgs
let glIntegration: { gitlabHost: string; namespacePath: string } | null;
let glReuseCount: number; // same namespace attached to OTHER orgs

const orgMemberCount = mock((args: { where?: Record<string, unknown> }) => {
  const w = args?.where ?? {};
  // The active-owner counts filter on deletedAt; hasEverOwnedOrg does not.
  return Promise.resolve("deletedAt" in w ? activeOwnedCount : everOwnedCount);
});
const userUpdateMany = mock(() => {
  claimCalled = true;
  // Behave like the DB: the claim only wins while welcomeGrantedAt is null,
  // and a won claim stamps the row (so a second call loses).
  const count = userRow.welcomeGrantedAt === null ? claimCount : 0;
  if (count === 1) userRow.welcomeGrantedAt = new Date();
  return Promise.resolve({ count });
});
const orgCreate = mock((args: { data: Record<string, unknown> }) => {
  createdData = args.data;
  return Promise.resolve({ id: "org1", ...args.data });
});

const client = {
  organizationMember: {
    count: orgMemberCount,
    findFirst: mock(() =>
      Promise.resolve({ userId: "u1", organization: { welcomeRiskReason: orgWelcomeRiskReason } }),
    ),
  },
  bitbucketIntegration: {
    findUnique: mock(() => Promise.resolve(bbIntegration)),
    count: mock(() => Promise.resolve(bbReuseCount)),
  },
  gitlabIntegration: {
    findUnique: mock(() => Promise.resolve(glIntegration)),
    count: mock(() => Promise.resolve(glReuseCount)),
  },
  account: { count: mock(() => Promise.resolve(accountCount)) },
  user: {
    findUnique: mock(() => Promise.resolve(userRow)),
    count: mock(() => Promise.resolve(ipPeerCount)),
    update: mock(() => Promise.resolve({})),
    updateMany: userUpdateMany,
  },
  organization: {
    findUnique: mock(() => Promise.resolve(null)), // slug is unique on first try
    create: orgCreate,
    update: mock((args: { data: Record<string, unknown> }) => {
      orgUpdates.push(args.data);
      return Promise.resolve({ creditBalance: 0, freeCreditBalance: 150 });
    }),
  },
  creditTransaction: {
    create: mock((args: { data: Record<string, unknown> }) => {
      creditTxCreates.push(args.data);
      return Promise.resolve({});
    }),
  },
  $transaction: (fn: (tx: typeof client) => unknown) => fn(client),
};

mock.module("@octopus/db", () => ({ prisma: client }));
// org-create → credits.ts pulls in server-only + stripe + the event bus;
// stub them the same way billing.test.ts does. Stub EVERY runtime export of
// @/lib/stripe: bun's mock.module is process-wide, and a partial mock breaks
// later test files that link other names (bun runs files newest-first).
mock.module("server-only", () => ({}));
mock.module("@/lib/stripe", () => ({
  getStripe: () => ({}),
  getOffSessionPaymentMethodId: () => Promise.resolve(null),
  getOrCreateStripeCustomer: () => Promise.resolve("cus_test"),
  createCheckoutSession: () => Promise.resolve({}),
  createSubscriptionCheckoutSession: () => Promise.resolve({}),
  createPortalSession: () => Promise.resolve({}),
  getCustomerPaymentMethods: () => Promise.resolve([]),
  constructWebhookEvent: () => ({}),
}));
mock.module("@/lib/events/bus", () => ({
  eventBus: { emit: () => {}, on: () => {}, off: () => {} },
}));

const { createOrgForUser, grantDeferredWelcomeCredit } = await import("@/lib/org-create");
const { WELCOME_FREE_CREDITS } = await import("@/lib/constants");

beforeEach(() => {
  userRow = { emailVerified: true, signupIp: null, welcomeGrantedAt: null };
  ipPeerCount = 0;
  everOwnedCount = 0;
  activeOwnedCount = 0;
  claimCount = 1;
  accountCount = 1; // default: user signed up via OAuth
  createdData = null;
  claimCalled = false;
  orgUpdates = [];
  creditTxCreates = [];
  orgWelcomeRiskReason = "deferred_no_oauth"; // default: org was marked deferred at creation
  bbIntegration = null;
  bbReuseCount = 0;
  glIntegration = null;
  glReuseCount = 0;
});

describe("createOrgForUser welcome-bonus gate", () => {
  it("clean first org with an OAuth accounts row: grants credits and claims the bonus", async () => {
    await createOrgForUser("u1", "Test User");
    expect(claimCalled).toBe(true);
    expect(createdData?.freeCreditBalance).toBe(WELCOME_FREE_CREDITS);
    expect(createdData?.creditTransactions).toBeDefined();
  });

  it("no OAuth accounts row (magic-link user): NOT granted at creation, welcomeGrantedAt stays null", async () => {
    accountCount = 0;
    await createOrgForUser("u1", "Test User");
    expect(claimCalled).toBe(false);
    expect(userRow.welcomeGrantedAt).toBeNull();
    expect(createdData?.freeCreditBalance).toBeUndefined();
    expect(createdData?.creditTransactions).toBeUndefined();
    // The deferral is marked on the org: the deferred release requires this
    // sentinel, so legacy null-stamp users can't mint a retroactive bonus.
    expect(createdData?.welcomeRiskReason).toBe("deferred_no_oauth");
  });

  it("high-velocity first org: withholds credits but STILL stamps (no refarm)", async () => {
    userRow.signupIp = "203.0.113.7";
    ipPeerCount = 5; // >= block threshold
    await createOrgForUser("u1", "Test User");
    expect(claimCalled).toBe(true); // consumed even though withheld
    expect(createdData?.freeCreditBalance).toBeUndefined(); // no credits
    expect(createdData?.welcomeRiskScore).toBeGreaterThan(0);
    expect(String(createdData?.welcomeRiskReason)).toContain("ip_velocity");
  });

  it("already granted (welcomeGrantedAt set): no credits, no re-claim", async () => {
    userRow.welcomeGrantedAt = new Date("2026-01-01T00:00:00Z");
    await createOrgForUser("u1", "Test User");
    expect(claimCalled).toBe(false);
    expect(createdData?.freeCreditBalance).toBeUndefined();
    expect(createdData?.welcomeRiskScore).toBeUndefined();
  });

  it("delete-recreate (owns a soft-deleted org): no credits, no claim", async () => {
    everOwnedCount = 1; // hasEverOwnedOrg → true
    await createOrgForUser("u1", "Test User");
    expect(claimCalled).toBe(false);
    expect(createdData?.freeCreditBalance).toBeUndefined();
  });
});

describe("grantDeferredWelcomeCredit (first repo connect)", () => {
  it("grants once on first connect; a second connect does not grant again", async () => {
    accountCount = 0;
    await grantDeferredWelcomeCredit("org1");
    expect(userRow.welcomeGrantedAt).not.toBeNull(); // claim consumed
    const grants = creditTxCreates.filter((t) => t.type === "free_credit");
    expect(grants.length).toBe(1);
    expect(grants[0]?.amount).toBe(WELCOME_FREE_CREDITS);
    expect(orgUpdates.some((d) => d.freeCreditBalance !== undefined)).toBe(true);

    await grantDeferredWelcomeCredit("org1"); // retry / second repo
    expect(creditTxCreates.filter((t) => t.type === "free_credit").length).toBe(1);
  });

  it("hold band on the deferred path: claim consumed, credits withheld", async () => {
    accountCount = 0;
    userRow.signupIp = "203.0.113.7";
    ipPeerCount = 5; // >= block threshold
    await grantDeferredWelcomeCredit("org1");
    expect(userRow.welcomeGrantedAt).not.toBeNull(); // consumed even though withheld
    expect(creditTxCreates.length).toBe(0); // no credits
    expect(orgUpdates.some((d) => "welcomeRiskScore" in d)).toBe(true); // risk recorded
    expect(orgUpdates.every((d) => d.freeCreditBalance === undefined)).toBe(true);
  });

  it("already granted (welcomeGrantedAt set): no-op", async () => {
    userRow.welcomeGrantedAt = new Date("2026-01-01T00:00:00Z");
    await grantDeferredWelcomeCredit("org1");
    expect(claimCalled).toBe(false);
    expect(creditTxCreates.length).toBe(0);
    expect(orgUpdates.length).toBe(0);
  });

  it("legacy org without the deferral marker: refused (no retroactive re-grant)", async () => {
    // Pre-stamp users have welcomeGrantedAt=NULL with no backfill; their orgs
    // never carry the deferral marker, so a repo sync must not mint a bonus.
    orgWelcomeRiskReason = null;
    await grantDeferredWelcomeCredit("org1");
    expect(claimCalled).toBe(false);
    expect(userRow.welcomeGrantedAt).toBeNull();
    expect(creditTxCreates.length).toBe(0);
    expect(orgUpdates.length).toBe(0);
  });

  it("Bitbucket workspace reused by another org: refused, claim NOT consumed", async () => {
    bbIntegration = { workspaceSlug: "shared-ws" };
    bbReuseCount = 1; // same workspace already attached elsewhere
    await grantDeferredWelcomeCredit("org1");
    expect(claimCalled).toBe(false);
    expect(userRow.welcomeGrantedAt).toBeNull(); // still releasable via an unshared forge
    expect(creditTxCreates.length).toBe(0);
  });

  it("GitLab namespace reused by another org: refused, claim NOT consumed", async () => {
    glIntegration = { gitlabHost: "https://gitlab.com", namespacePath: "shared-ns" };
    glReuseCount = 1;
    await grantDeferredWelcomeCredit("org1");
    expect(claimCalled).toBe(false);
    expect(userRow.welcomeGrantedAt).toBeNull();
    expect(creditTxCreates.length).toBe(0);
  });
});
