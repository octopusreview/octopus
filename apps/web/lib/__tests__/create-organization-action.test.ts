import { beforeEach, describe, expect, it, mock } from "bun:test";

// The manual create-org server action (app/(app)/actions.ts createOrganization)
// duplicates the welcome claim+grant block from lib/org-create.ts. This locks
// the OAuth-accounts-row gate onto that path too: a magic-link user with a
// session must NOT receive the $150 at creation through the action (the
// signup-farm profile — see issue #788); their grant is deferred to first
// repo connect, marked on the org.

type UserRow = {
  emailVerified: boolean;
  signupIp: string | null;
  welcomeGrantedAt: Date | null;
};

let userRow: UserRow;
let ipPeerCount: number;
let everOwnedCount: number; // hasEverOwnedOrg (no deletedAt filter)
let activeOwnedCount: number; // cap check (deletedAt: null)
let accountCount: number; // OAuth `accounts` rows for the user
let createdData: Record<string, unknown> | null;
let claimCalled: boolean;

const client = {
  organizationMember: {
    count: mock((args: { where?: Record<string, unknown> }) => {
      const w = args?.where ?? {};
      return Promise.resolve("deletedAt" in w ? activeOwnedCount : everOwnedCount);
    }),
  },
  account: { count: mock(() => Promise.resolve(accountCount)) },
  user: {
    findUnique: mock(() => Promise.resolve(userRow)),
    count: mock(() => Promise.resolve(ipPeerCount)),
    update: mock(() => Promise.resolve({})),
    updateMany: mock(() => {
      claimCalled = true;
      const count = userRow.welcomeGrantedAt === null ? 1 : 0;
      if (count === 1) userRow.welcomeGrantedAt = new Date();
      return Promise.resolve({ count });
    }),
  },
  organization: {
    findUnique: mock(() => Promise.resolve(null)), // slug unique on first try
    create: mock((args: { data: Record<string, unknown> }) => {
      createdData = args.data;
      return Promise.resolve({ id: "org1", ...args.data });
    }),
  },
  $transaction: (fn: (tx: typeof client) => unknown) => fn(client),
};

mock.module("@octopus/db", () => ({ prisma: client }));
mock.module("server-only", () => ({}));
// Stub EVERY runtime export of @/lib/stripe: bun's mock.module is
// process-wide, and a partial mock breaks later test files that link other
// names (bun runs files newest-first).
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
// actions.ts pulls the whole app surface; stub everything heavy it imports.
mock.module("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () => Promise.resolve({ set: () => {}, get: () => undefined, delete: () => {} }),
}));
mock.module("next/navigation", () => ({ redirect: () => {} }));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));
mock.module("@/lib/auth", () => ({
  auth: { api: { getSession: () => Promise.resolve({ user: { id: "u1", name: "Test User" } }) } },
}));
mock.module("@/lib/org-permissions", () => ({ hasOrgPermission: () => Promise.resolve(true) }));
mock.module("@/lib/pubby", () => ({ pubby: {} }));
mock.module("@/lib/elasticsearch", () => ({
  writeSyncLog: () => Promise.resolve(),
  deleteSyncLogs: () => Promise.resolve(),
}));
mock.module("@/lib/github", () => ({ listInstallationRepos: () => Promise.resolve([]) }));
mock.module("@/lib/bitbucket", () => ({ listWorkspaceRepos: () => Promise.resolve([]) }));
mock.module("@/lib/indexing-abort", () => ({
  createAbortController: () => new AbortController(),
  abortIndexing: () => {},
}));
mock.module("@/lib/indexing-runner", () => ({ runIndexingInBackground: () => {} }));
mock.module("@/lib/crypto", () => ({ encryptString: () => "" }));
mock.module("@/lib/providers/url-validation", () => ({ validateProviderUrl: () => null }));
mock.module("@/lib/providers/thinking", () => ({ asThinkingEffort: () => null }));
mock.module("@/lib/audit", () => ({ writeAuditLog: () => Promise.resolve() }));
mock.module("@/lib/entitlements", () => ({ canUseLiveTelemetry: () => Promise.resolve(false) }));
mock.module("@/lib/request-ip", () => ({ getClientIp: () => "127.0.0.1" }));
mock.module("@/lib/presence", () => ({ clearPresence: () => Promise.resolve() }));

const { createOrganization } = await import("@/app/(app)/actions");
const { WELCOME_FREE_CREDITS } = await import("@/lib/constants");
const { WELCOME_DEFERRED_REASON } = await import("@/lib/org-create");

function orgForm(name = "Test Org"): FormData {
  const fd = new FormData();
  fd.set("name", name);
  return fd;
}

beforeEach(() => {
  userRow = { emailVerified: true, signupIp: null, welcomeGrantedAt: null };
  ipPeerCount = 0;
  everOwnedCount = 0;
  activeOwnedCount = 0;
  accountCount = 1; // default: user signed up via OAuth
  createdData = null;
  claimCalled = false;
});

describe("createOrganization action welcome-bonus gate", () => {
  it("OAuth accounts row: grants at creation as before", async () => {
    const res = await createOrganization({}, orgForm());
    expect(res?.error).toBeUndefined();
    expect(claimCalled).toBe(true);
    expect(createdData?.freeCreditBalance).toBe(WELCOME_FREE_CREDITS);
  });

  it("no OAuth accounts row (magic-link user): NOT granted, deferred marker set", async () => {
    accountCount = 0;
    const res = await createOrganization({}, orgForm());
    expect(res?.error).toBeUndefined();
    expect(claimCalled).toBe(false);
    expect(userRow.welcomeGrantedAt).toBeNull();
    expect(createdData?.freeCreditBalance).toBeUndefined();
    expect(createdData?.creditTransactions).toBeUndefined();
    expect(createdData?.welcomeRiskReason).toBe(WELCOME_DEFERRED_REASON);
  });
});
