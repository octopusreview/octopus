import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

process.env.BETTER_AUTH_SECRET ??= "test-secret-for-integration-oauth-state";
process.env.BETTER_AUTH_URL ??= "https://app.test";
process.env.LINEAR_CLIENT_ID ??= "linear-client";
process.env.LINEAR_CLIENT_SECRET ??= "linear-secret";
process.env.LINEAR_REDIRECT_URI ??= "https://app.test/api/linear/callback";
process.env.JIRA_CLIENT_ID ??= "jira-client";
process.env.JIRA_CLIENT_SECRET ??= "jira-secret";
process.env.JIRA_REDIRECT_URI ??= "https://app.test/api/jira/callback";
process.env.BITBUCKET_CLIENT_ID ??= "bitbucket-client";
process.env.BITBUCKET_CLIENT_SECRET ??= "bitbucket-secret";
process.env.BITBUCKET_REDIRECT_URI ??= "https://app.test/api/bitbucket/callback";

const ORG_ID = "org_admin_controls";
const USER_ID = "user_admin";

let requestCookies: Map<string, string>;
let currentUserId: string;
const mockFetch = mock(() =>
  Promise.resolve(
    new Response(JSON.stringify({ error: "invalid_grant" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }),
  ),
);

const actualHeaders = await import("next/headers");
const actualAuth = await import("@/lib/auth");
const actualDb = await import("@octopus/db");

mock.module("next/headers", () => ({
  ...actualHeaders,
  headers: () => Promise.resolve(new Headers()),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        requestCookies.has(name)
          ? { name, value: requestCookies.get(name)! }
          : undefined,
      set: (name: string, value: string) => requestCookies.set(name, value),
      delete: (name: string) => requestCookies.delete(name),
    }),
}));

mock.module("@/lib/auth", () => ({
  ...actualAuth,
  auth: {
    api: {
      getSession: () => Promise.resolve({ user: { id: currentUserId } }),
    },
  },
}));

mock.module("@octopus/db", () => ({
  ...actualDb,
  prisma: {
    organizationMember: {
      findFirst: () => Promise.resolve({ role: "owner" }),
    },
  },
}));

// mock.module leaks into other test files in the same `bun test` run, so
// preserve each module's real exports and override only what this file stubs.
const actualLinear = await import("@/lib/linear");
const actualAudit = await import("@/lib/audit");
const actualJira = await import("@/lib/jira");
const actualBitbucket = await import("@/lib/bitbucket");

mock.module("@/lib/linear", () => ({
  ...actualLinear,
  getLinearViewer: () => Promise.reject(new Error("not reached")),
}));
mock.module("@/lib/audit", () => ({
  ...actualAudit,
  writeAuditLog: () => Promise.resolve(),
}));
mock.module("@/lib/jira", () => ({
  ...actualJira,
  encryptJiraToken: (value: string) => value,
  getAccessibleResources: () => Promise.resolve([]),
}));
mock.module("@/lib/bitbucket", () => ({
  ...actualBitbucket,
  createWebhook: () => Promise.resolve(null),
  listWorkspaceRepos: () => Promise.resolve([]),
}));

const originalFetch = globalThis.fetch;
const { GET: linearStart } = await import("@/app/api/linear/oauth/route");
const { GET: linearCallback } = await import("@/app/api/linear/callback/route");
const { GET: jiraStart } = await import("@/app/api/jira/oauth/route");
const { GET: jiraCallback } = await import("@/app/api/jira/callback/route");
const { GET: bitbucketStart } = await import("@/app/api/bitbucket/oauth/route");
const { GET: bitbucketCallback } = await import(
  "@/app/api/bitbucket/callback/route"
);
const {
  createIntegrationOAuthState,
  INTEGRATION_OAUTH_STATE_TTL_MS,
  verifyIntegrationOAuthState,
} = await import("@/lib/integration-oauth-state");

function callbackRequest(provider: string, state: string) {
  const url = new URL(`https://app.test/api/${provider}/callback`);
  url.searchParams.set("code", "attacker-code");
  url.searchParams.set("state", state);
  return Object.assign(new Request(url), { nextUrl: url }) as never;
}

function errorOf(response: Response): string | null {
  return new URL(response.headers.get("location")!).searchParams.get("error");
}

type Provider = "linear" | "jira" | "bitbucket";

async function startFlow(provider: Provider): Promise<Response> {
  if (provider === "linear") return linearStart();
  if (provider === "jira") return jiraStart();
  return bitbucketStart(
    new Request("https://app.test/api/bitbucket/oauth?workspace=workspace"),
  );
}

const callbacks = {
  linear: linearCallback,
  jira: jiraCallback,
  bitbucket: bitbucketCallback,
};

beforeEach(() => {
  requestCookies = new Map([["current_org_id", ORG_ID]]);
  currentUserId = USER_ID;
  mockFetch.mockClear();
  globalThis.fetch = mockFetch as typeof fetch;
});

describe("integration OAuth state boundary", () => {
  it.each([
    ["linear", linearCallback, { orgId: ORG_ID }],
    ["jira", jiraCallback, { orgId: ORG_ID }],
    [
      "bitbucket",
      bitbucketCallback,
      { orgId: ORG_ID, nonce: "attacker-chosen", workspaceSlug: "workspace" },
    ],
  ] as const)(
    "%s rejects attacker-authored state before exchanging the code",
    async (provider, callback, payload) => {
      const forgedState = Buffer.from(JSON.stringify(payload)).toString("base64url");

      const response = await callback(callbackRequest(provider, forgedState));

      expect(errorOf(response)).toBe("invalid_state");
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it("rejects expired server-issued state", () => {
    const issuedAt = 1_000;
    const issued = createIntegrationOAuthState({
      provider: "linear",
      orgId: ORG_ID,
      userId: USER_ID,
      now: issuedAt,
    });

    expect(
      verifyIntegrationOAuthState({
        state: issued.state,
        cookieNonce: issued.nonce,
        provider: "linear",
        now: issuedAt + INTEGRATION_OAUTH_STATE_TTL_MS + 1,
      }),
    ).toEqual({ ok: false, error: "state_expired" });
  });

  it.each(["linear", "jira", "bitbucket"] as const)(
    "%s rejects genuine state replayed through a browser without its nonce cookie",
    async (provider) => {
      const startResponse = await startFlow(provider);
      const state = new URL(startResponse.headers.get("location")!).searchParams.get(
        "state",
      )!;

      requestCookies = new Map();
      const response = await callbacks[provider](
        callbackRequest(provider, state),
      );

      expect(errorOf(response)).toBe("invalid_state");
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it.each(["linear", "jira", "bitbucket"] as const)(
    "%s accepts state from the same browser and reaches the provider exchange",
    async (provider) => {
      const startResponse = await startFlow(provider);
      const location = new URL(startResponse.headers.get("location")!);
      const state = location.searchParams.get("state")!;
      const cookieName = `${provider}_oauth_state`;
      const nonce = startResponse.cookies.get(cookieName)!.value;

      requestCookies = new Map([[cookieName, nonce]]);
      const response = await callbacks[provider](
        callbackRequest(provider, state),
      );

      expect(errorOf(response)).toBe("token_exchange");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(requestCookies.has(cookieName)).toBeFalse();
    },
  );

  it("rejects a callback completed by a different signed-in user", async () => {
    const startResponse = await startFlow("linear");
    const location = new URL(startResponse.headers.get("location")!);
    const state = location.searchParams.get("state")!;
    const cookieName = "linear_oauth_state";
    const nonce = startResponse.cookies.get(cookieName)!.value;

    currentUserId = "user_other";
    requestCookies = new Map([[cookieName, nonce]]);
    const response = await linearCallback(callbackRequest("linear", state));

    expect(errorOf(response)).toBe("forbidden");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});
