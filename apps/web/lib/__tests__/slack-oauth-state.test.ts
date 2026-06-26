import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// Real crypto is used (not mocked) so the test exercises actual state
// encryption/decryption and the cookie<->state nonce binding. crypto.ts reads
// the key from env at call time, so setting it here is enough.
process.env.BETTER_AUTH_SECRET ??= "test-secret-for-slack-oauth-state-binding";
process.env.SLACK_CLIENT_ID ??= "client-id";
process.env.SLACK_CLIENT_SECRET ??= "client-secret";
process.env.SLACK_REDIRECT_URI ??= "https://app.test/api/slack/callback";
process.env.BETTER_AUTH_URL ??= "https://app.test";

// ── Controllable test state ──────────────────────────────────────────────────
type Session = { user: { id: string } } | null;
let currentSession: Session;
let memberRole: string | null; // role returned by organizationMember.findFirst
let requestCookies: Map<string, string>; // cookies the "browser" sends back
let upsertedIntegration: { teamId: string; organizationId: string } | null;

const mockGetSession = mock(() => Promise.resolve(currentSession));
const mockMemberFindFirst = mock(() =>
  Promise.resolve(memberRole ? { role: memberRole } : null),
);
const mockIntegrationUpsert = mock(
  ({ where, create }: { where: { organizationId: string }; create: { teamId: string } }) => {
    upsertedIntegration = {
      teamId: create.teamId,
      organizationId: where.organizationId,
    };
    return Promise.resolve({ id: "integration_1" });
  },
);
const mockEventConfigUpsert = mock(() => Promise.resolve({}));

// `next/headers` cookies()/headers() — backed by the controllable map.
mock.module("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        requestCookies.has(name) ? { name, value: requestCookies.get(name)! } : undefined,
      set: (name: string, value: string) => requestCookies.set(name, value),
      delete: (name: string) => requestCookies.delete(name),
    }),
}));

mock.module("@/lib/auth", () => ({
  auth: { api: { getSession: (...a: unknown[]) => mockGetSession(...(a as [])) } },
}));

mock.module("@octopus/db", () => ({
  prisma: {
    organizationMember: { findFirst: (...a: unknown[]) => mockMemberFindFirst(...(a as [])) },
    slackIntegration: { upsert: (...a: unknown[]) => mockIntegrationUpsert(...(a as [{ where: { organizationId: string }; create: { teamId: string } }])) },
    slackEventConfig: { upsert: (...a: unknown[]) => mockEventConfigUpsert(...(a as [])) },
  },
}));

// Token exchange with Slack — return a fixed mock workspace.
const originalFetch = globalThis.fetch;

const { GET: oauthStart } = await import("@/app/api/slack/oauth/route");
const { GET: oauthCallback } = await import("@/app/api/slack/callback/route");

const VICTIM_ORG = "org_victim_owned_test";
const VICTIM_ADMIN = "user_victim_admin";
// The Slack workspace returned by the mocked token endpoint in every test.
// Named neutrally because the happy-path test legitimately connects it; the
// attack semantics in the other tests come from the cookie/state mismatch, not
// from this id.
const MOCK_SLACK_TEAM = "T_MOCK_SLACK_TEAM";

function callbackRequest(params: Record<string, string>) {
  const url = new URL("https://app.test/api/slack/callback");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // NextRequest is what the route types expect; a plain Request with nextUrl works
  // for these handlers since they only read `nextUrl.searchParams`.
  return Object.assign(new Request(url), { nextUrl: url }) as never;
}

function locationOf(res: Response) {
  return new URL(res.headers.get("location")!);
}

beforeEach(() => {
  currentSession = { user: { id: VICTIM_ADMIN } };
  memberRole = "owner";
  requestCookies = new Map([["current_org_id", VICTIM_ORG]]);
  upsertedIntegration = null;
  mockIntegrationUpsert.mockClear();
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          ok: true,
          team: { id: MOCK_SLACK_TEAM, name: "Mock Slack Workspace" },
          access_token: "xoxb-mock-token",
          bot_user_id: "B_MOCK",
        }),
      ),
    ),
  ) as typeof fetch;
});

describe("slack oauth state CSRF binding", () => {
  it("rejects a forged plaintext state (old attack: base64url({orgId}))", async () => {
    const forgedState = Buffer.from(JSON.stringify({ orgId: VICTIM_ORG })).toString(
      "base64url",
    );
    const res = await oauthCallback(
      callbackRequest({ code: "attacker_code", state: forgedState }),
    );
    expect(locationOf(res).searchParams.get("error")).toBe("invalid_state");
    expect(upsertedIntegration).toBeNull();
  });

  it("rejects a valid server-issued state when the initiating cookie is absent (CSRF)", async () => {
    // Attacker completes their own OAuth start to obtain a genuine encrypted state...
    requestCookies = new Map([["current_org_id", VICTIM_ORG]]);
    const startRes = await oauthStart();
    const state = locationOf(startRes).searchParams.get("state")!;

    // ...then replays it through a VICTIM browser that never initiated OAuth,
    // so it carries no slack_oauth_state cookie.
    requestCookies = new Map(); // victim has no state cookie
    const res = await oauthCallback(callbackRequest({ code: "attacker_code", state }));

    expect(locationOf(res).searchParams.get("error")).toBe("invalid_state");
    expect(upsertedIntegration).toBeNull();
  });

  it("rejects when a different user completes the flow than started it", async () => {
    const startRes = await oauthStart(); // started by VICTIM_ADMIN
    const state = locationOf(startRes).searchParams.get("state")!;
    const nonce = startRes.cookies.get("slack_oauth_state")!.value;

    // A different logged-in user replays the same state + cookie.
    currentSession = { user: { id: "user_someone_else" } };
    requestCookies = new Map([["slack_oauth_state", nonce]]);
    const res = await oauthCallback(callbackRequest({ code: "code", state }));

    expect(locationOf(res).searchParams.get("error")).toBe("forbidden");
    expect(upsertedIntegration).toBeNull();
  });

  it("accepts the genuine flow: same browser, same user, admin role", async () => {
    const startRes = await oauthStart();
    const state = locationOf(startRes).searchParams.get("state")!;
    const nonce = startRes.cookies.get("slack_oauth_state")!.value;

    // Browser sends the state cookie back on the callback navigation.
    requestCookies = new Map([["slack_oauth_state", nonce]]);
    const res = await oauthCallback(callbackRequest({ code: "code", state }));

    expect(locationOf(res).searchParams.get("success")).toBe("slack");
    expect(upsertedIntegration).toEqual({
      teamId: MOCK_SLACK_TEAM,
      organizationId: VICTIM_ORG,
    });
  });
});

// restore fetch for any later test files in the same process
afterAll(() => {
  globalThis.fetch = originalFetch;
});
