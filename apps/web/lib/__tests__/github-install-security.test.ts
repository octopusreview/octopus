import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import crypto from "node:crypto";
import { getRepositoryConnectionRecovery } from "@/lib/repository-connection-recovery";

mock.module("server-only", () => ({}));

process.env.BETTER_AUTH_URL = "https://app.test";
process.env.GITHUB_STATE_SECRET =
  "github-install-security-test-secret-32-bytes";

type Session = { user: { id: string } } | null;

let currentSession: Session = null;
let boundInstallationId: number | null = null;
let requestCookies = new Map<string, string>();
let installationAccessible = false;
let clientCredentialsConfigured = true;
let existingBinding: { id: string; deletedAt: Date | null } | null = null;
let repositoryListingFails = false;
const setupUpdates: Array<Record<string, unknown>> = [];

const TEST_PRIVATE_KEY = crypto
  .generateKeyPairSync("rsa", { modulusLength: 1024 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();

const redisSet = mock((..._args: unknown[]): Promise<string | null> => Promise.resolve("OK"));
const redisGet = mock((..._args: unknown[]): Promise<string | null> => Promise.resolve(null));
const captureException = mock((..._args: unknown[]) => "event-id");
const realSentry = await import("@sentry/nextjs");
mock.module("@sentry/nextjs", () => ({ ...realSentry, captureException }));
const storeDown = () => Promise.reject(new Error("Stream isn't writeable and enableOfflineQueue options is false"));
const organizationUpdate = mock(
  ({ where, data }: { where: { id: string }; data: { githubInstallationId: number | null } }) => {
    if (where.id === "org_victim") boundInstallationId = data.githubInstallationId;
    return Promise.resolve({ id: where.id });
  },
);

mock.module("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        requestCookies.has(name)
          ? { name, value: requestCookies.get(name)! }
          : undefined,
    }),
}));

mock.module("next/cache", () => ({ revalidatePath: mock(() => undefined) }));

mock.module("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: () => Promise.resolve(currentSession),
    },
  },
}));

mock.module("@/lib/redis", () => ({
  getRedis: () => ({ set: redisSet, get: redisGet }),
}));

const writeAuditLog = mock((_entry: Record<string, unknown>) => Promise.resolve());
mock.module("@/lib/audit", () => ({ writeAuditLog }));

let githubAppConfigured = true;

mock.module("@/lib/github-app-config", () => ({
  getGithubAppConfig: () =>
    Promise.resolve(
      githubAppConfigured
        ? {
            appId: "123",
            slug: "octopus-review",
            privateKey: TEST_PRIVATE_KEY,
            clientId: clientCredentialsConfigured ? "github-app-client-id" : null,
            clientSecret: clientCredentialsConfigured ? "github-app-client-secret" : null,
          }
        : null,
    ),
}));

const originalFetch = globalThis.fetch;
globalThis.fetch = mock((input: string | URL | Request) => {
  const url = String(input);
  if (url === "https://github.com/login/oauth/access_token") {
    return Promise.resolve(
      Response.json({ access_token: "github-app-user-token" }),
    );
  }
  if (url.startsWith("https://api.github.com/user/installations?")) {
    return Promise.resolve(
      Response.json({
        installations: installationAccessible ? [{ id: 424242 }] : [],
      }),
    );
  }
  if (url === "https://api.github.com/app/installations/424242/access_tokens") {
    return Promise.resolve(Response.json({ token: "installation-token" }));
  }
  if (url.startsWith("https://api.github.com/installation/repositories?")) {
    if (repositoryListingFails) return Promise.resolve(new Response("fixture provider error", { status: 500 }));
    return Promise.resolve(Response.json({ repositories: [] }));
  }
  throw new Error(`Unexpected GitHub request in test: ${url}`);
}) as typeof fetch;

mock.module("@octopus/db", () => ({
  prisma: {
    organizationMember: {
      findFirst: () => Promise.resolve({ organizationId: "org_victim" }),
    },
    organization: {
      findUnique: ({ where }: { where: { githubInstallationId?: number } }) => Promise.resolve(where.githubInstallationId ? existingBinding : { githubInstallationId: boundInstallationId }),
      update: organizationUpdate,
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { setupUpdates.push(data); return { count: 1 }; },
    },
    repository: {
      findMany: () => Promise.resolve([]),
      upsert: () => Promise.resolve({}),
      updateMany: () => Promise.resolve({ count: 0 }),
    },
  },
}));

const {
  GITHUB_INSTALL_STATE_COOKIE,
  safeReturnPath,
  signInstallationVerificationState,
  signInstallState,
} = await import("@/lib/github-install-state");
const { GET } = await import("@/app/api/github/callback/route");
const { GET: GET_INSTALL } = await import("@/app/api/github/install/route");

function callbackRequest(params: Record<string, string>) {
  const url = new URL("https://app.test/api/github/callback");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return Object.assign(new Request(url), { nextUrl: url }) as never;
}

function installRequest(params: Record<string, string>) {
  const url = new URL("https://app.test/api/github/install");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return Object.assign(new Request(url), { nextUrl: url }) as never;
}

beforeEach(() => {
  githubAppConfigured = true;
  currentSession = { user: { id: "user_victim" } };
  boundInstallationId = null;
  requestCookies = new Map();
  installationAccessible = false;
  clientCredentialsConfigured = true;
  existingBinding = null;
  repositoryListingFails = false;
  setupUpdates.length = 0;
  redisSet.mockReset();
  redisSet.mockImplementation(() => Promise.resolve("OK"));
  redisGet.mockReset();
  redisGet.mockImplementation(() => Promise.resolve(null));
  captureException.mockClear();
  organizationUpdate.mockClear();
  writeAuditLog.mockClear();
});

function auditEntries(): Array<Record<string, unknown>> {
  return writeAuditLog.mock.calls.map((call) => call[0]);
}

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("GitHub installation callback authorization", () => {
  it("bounces a state-less GitHub-initiated install through login to /api/github/install", async () => {
    const response: Response = await GET(
      callbackRequest({ installation_id: "424242" }),
    );

    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("callbackUrl")).toBe(
      "/api/github/install?returnTo=%2Fsettings%2Fintegrations",
    );
    expect(boundInstallationId).toBeNull();
  });

  it("does not bind an installation when another signed-in user completes the callback", async () => {
    const nonce = "victim-browser-nonce";
    const state = signInstallState({
      uid: "user_victim",
      oid: "org_victim",
      rt: "/settings/integrations",
      nonce,
    });
    requestCookies.set(GITHUB_INSTALL_STATE_COOKIE, nonce);
    currentSession = { user: { id: "user_attacker" } };

    const response = await GET(
      callbackRequest({ state, installation_id: "424242" }),
    );
    const location = new URL(response.headers.get("location")!);

    expect(location.searchParams.get("error")).toBe("state_user_mismatch");
    expect(boundInstallationId).toBeNull();
    expect(organizationUpdate).not.toHaveBeenCalled();
  });

  it("does not bind the caller-provided id before GitHub user authorization", async () => {
    const nonce = "install-browser-nonce";
    const state = signInstallState({
      uid: "user_victim",
      oid: "org_victim",
      rt: "/settings/integrations",
      nonce,
    });
    requestCookies.set(GITHUB_INSTALL_STATE_COOKIE, nonce);

    const response = await GET(
      callbackRequest({ state, installation_id: "424242" }),
    );
    const location = new URL(response.headers.get("location")!);

    expect(location.origin).toBe("https://github.com");
    expect(location.pathname).toBe("/login/oauth/authorize");
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(boundInstallationId).toBeNull();
  });

  it("rejects an installation that GitHub does not associate with the authorized user", async () => {
    const nonce = "verification-browser-nonce";
    const state = signInstallationVerificationState({
      uid: "user_victim",
      oid: "org_victim",
      rt: "/settings/integrations",
      nonce,
      installationId: 424242,
    });
    requestCookies.set(GITHUB_INSTALL_STATE_COOKIE, nonce);

    const response = await GET(callbackRequest({ state, code: "one-time-code" }));
    const location = new URL(response.headers.get("location")!);

    expect(location.searchParams.get("error")).toBe("installation_not_accessible");
    expect(boundInstallationId).toBeNull();
  });

  it("binds after the same browser, same session, and GitHub user all verify", async () => {
    const nonce = "verified-browser-nonce";
    const state = signInstallationVerificationState({
      uid: "user_victim",
      oid: "org_victim",
      rt: "/settings/integrations",
      nonce,
      installationId: 424242,
    });
    requestCookies.set(GITHUB_INSTALL_STATE_COOKIE, nonce);
    installationAccessible = true;

    const response = await GET(callbackRequest({ state, code: "one-time-code" }));
    const location = new URL(response.headers.get("location")!);

    expect(location.pathname).toBe("/settings/integrations");
    expect(location.searchParams.get("error")).toBeNull();
    expect(boundInstallationId).toBe(424242);
    expect(setupUpdates.at(-1)).toMatchObject({ githubSetupStatus: { sync: { status: "ready" }, webhook: { status: "unknown" } } });
  });

  describe("state replay store", () => {
    async function verifiedCallback() {
      const nonce = "store-browser-nonce";
      const state = signInstallationVerificationState({
        uid: "user_victim", oid: "org_victim", rt: "/settings/integrations", nonce, installationId: 424242,
      });
      requestCookies.set(GITHUB_INSTALL_STATE_COOKIE, nonce);
      installationAccessible = true;
      const response = await GET(callbackRequest({ state, code: "one-time-code" }));
      return new URL(response.headers.get("location")!).searchParams.get("error");
    }

    it("connects when the store rejects one command during a reconnect", async () => {
      redisSet.mockImplementationOnce(storeDown);

      expect(await verifiedCallback()).toBeNull();
      expect(boundInstallationId).toBe(424242);
      expect(redisSet).toHaveBeenCalledTimes(2);
      expect(captureException).not.toHaveBeenCalled();
    });

    it("accepts its own earlier write when only the reply was lost", async () => {
      redisSet.mockImplementationOnce(storeDown);
      redisSet.mockImplementationOnce(() => Promise.resolve(null));
      redisGet.mockImplementation(() => Promise.resolve(redisSet.mock.calls[0][1] as string));

      expect(await verifiedCallback()).toBeNull();
      expect(boundInstallationId).toBe(424242);
    });

    it("refuses a state another request consumed, on the first attempt and after a failed one", async () => {
      redisSet.mockImplementation(() => Promise.resolve(null));
      expect(await verifiedCallback()).toBe("replay_detected");
      expect(redisGet).not.toHaveBeenCalled();

      redisSet.mockReset();
      redisSet.mockImplementationOnce(storeDown);
      redisSet.mockImplementation(() => Promise.resolve(null));
      redisGet.mockImplementation(() => Promise.resolve("written-by-another-request"));
      expect(await verifiedCallback()).toBe("replay_detected");
      expect(boundInstallationId).toBeNull();
      expect(organizationUpdate).not.toHaveBeenCalled();
    });

    it("fails closed and reports once when the store stays down", async () => {
      redisSet.mockImplementation(storeDown);

      expect(await verifiedCallback()).toBe("state_store_unavailable");
      expect(boundInstallationId).toBeNull();
      expect(organizationUpdate).not.toHaveBeenCalled();
      expect(redisSet).toHaveBeenCalledTimes(3);
      expect(captureException).toHaveBeenCalledTimes(1);
    });
  });

  it("retains verified authorization but exposes failed repository setup", async () => {
    const nonce = "setup-failure-nonce";
    const state = signInstallationVerificationState({ uid: "user_victim", oid: "org_victim", rt: "/settings/integrations", nonce, installationId: 424242 });
    requestCookies.set(GITHUB_INSTALL_STATE_COOKIE, nonce);
    installationAccessible = true;
    repositoryListingFails = true;
    const response = await GET(callbackRequest({ state, code: "one-time-code" }));
    const location = new URL(response.headers.get("location")!);
    expect(boundInstallationId).toBe(424242);
    expect(location.searchParams.get("setup")).toBe("attention");
    expect(setupUpdates.at(-1)).toMatchObject({ githubSetupStatus: { sync: { status: "failed" }, webhook: { status: "unknown" } } });
  });

  it("clears the state nonce cookie on its own path after completion", async () => {
    const nonce = "cookie-cleanup-nonce";
    const state = signInstallationVerificationState({
      uid: "user_victim",
      oid: "org_victim",
      rt: "/settings/integrations",
      nonce,
      installationId: 424242,
    });
    requestCookies.set(GITHUB_INSTALL_STATE_COOKIE, nonce);
    installationAccessible = true;

    const response = await GET(callbackRequest({ state, code: "one-time-code" }));
    const setCookie = response.headers.get("set-cookie")!;

    expect(setCookie).toContain(`${GITHUB_INSTALL_STATE_COOKIE}=;`);
    expect(setCookie).toContain("Path=/api/github/callback");
  });

  it("records who hit a missing-client-credentials failure and never shows it as the user's fault", async () => {
    clientCredentialsConfigured = false;
    const nonce = "unconfigured-browser-nonce";
    const state = signInstallState({
      uid: "user_victim",
      oid: "org_victim",
      rt: "/settings/integrations",
      nonce,
    });
    requestCookies.set(GITHUB_INSTALL_STATE_COOKIE, nonce);

    const response = await GET(
      callbackRequest({ state, installation_id: "424242" }),
    );
    const location = new URL(response.headers.get("location")!);

    expect(location.searchParams.get("error")).toBe("github_verification_not_configured");
    expect(boundInstallationId).toBeNull();
    const failure = auditEntries().find((e) => e.action === "integration.install_failed");
    expect(failure).toMatchObject({
      actorId: "user_victim",
      organizationId: "org_victim",
      metadata: { provider: "github", reason: "github_verification_not_configured" },
    });
  });

  it("attributes a GitHub authorization denial to the user and keeps GitHub's error code", async () => {
    const nonce = "denied-browser-nonce";
    const state = signInstallationVerificationState({
      uid: "user_victim",
      oid: "org_victim",
      rt: "/settings/integrations",
      nonce,
      installationId: 424242,
    });
    requestCookies.set(GITHUB_INSTALL_STATE_COOKIE, nonce);

    const response = await GET(
      callbackRequest({ state, error: "redirect_uri_mismatch" }),
    );
    const location = new URL(response.headers.get("location")!);

    expect(location.searchParams.get("error")).toBe("github_authorization_denied");
    expect(auditEntries()).toContainEqual(
      expect.objectContaining({
        action: "integration.install_failed",
        actorId: "user_victim",
        organizationId: "org_victim",
        metadata: expect.objectContaining({
          reason: "github_authorization_denied",
          githubError: "redirect_uri_mismatch",
        }),
      }),
    );
  });

  it("records a pending-approval return (no installation_id) without failing the user", async () => {
    const nonce = "pending-browser-nonce";
    const state = signInstallState({
      uid: "user_victim",
      oid: "org_victim",
      rt: "/settings/integrations",
      nonce,
    });
    requestCookies.set(GITHUB_INSTALL_STATE_COOKIE, nonce);

    const response = await GET(callbackRequest({ state, setup_action: "request" }));
    const location = new URL(response.headers.get("location")!);

    expect(location.pathname).toBe("/settings/integrations");
    expect(location.searchParams.get("error")).toBeNull();
    await Promise.resolve();
    expect(auditEntries()).toContainEqual(
      expect.objectContaining({
        actorId: "user_victim",
        organizationId: "org_victim",
        metadata: expect.objectContaining({ reason: "installation_pending_approval" }),
      }),
    );
  });

  it("releases an installation held by a soft-deleted organization and binds the new one", async () => {
    existingBinding = { id: "org_deleted", deletedAt: new Date("2026-08-01T00:00:00Z") };
    const nonce = "release-browser-nonce";
    const state = signInstallationVerificationState({
      uid: "user_victim",
      oid: "org_victim",
      rt: "/settings/integrations",
      nonce,
      installationId: 424242,
    });
    requestCookies.set(GITHUB_INSTALL_STATE_COOKIE, nonce);
    installationAccessible = true;

    const response = await GET(callbackRequest({ state, code: "one-time-code" }));
    const location = new URL(response.headers.get("location")!);

    expect(location.searchParams.get("error")).toBeNull();
    expect(boundInstallationId).toBe(424242);
    expect(organizationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "org_deleted" },
        data: { githubInstallationId: null },
      }),
    );
  });

  it("still refuses to steal an installation from a live organization", async () => {
    existingBinding = { id: "org_other_live", deletedAt: null };
    const nonce = "steal-browser-nonce";
    const state = signInstallationVerificationState({
      uid: "user_victim",
      oid: "org_victim",
      rt: "/settings/integrations",
      nonce,
      installationId: 424242,
    });
    requestCookies.set(GITHUB_INSTALL_STATE_COOKIE, nonce);
    installationAccessible = true;

    const response = await GET(callbackRequest({ state, code: "one-time-code" }));
    const location = new URL(response.headers.get("location")!);

    expect(location.searchParams.get("error")).toBe("installation_already_bound");
    expect(boundInstallationId).toBeNull();
  });

  it("does not redirect off-origin for a backslash return path", async () => {
    const nonce = "redirect-browser-nonce";
    const state = signInstallationVerificationState({
      uid: "user_victim",
      oid: "org_victim",
      rt: "/\\evil.com",
      nonce,
      installationId: 424242,
    });
    requestCookies.set(GITHUB_INSTALL_STATE_COOKIE, nonce);
    installationAccessible = true;

    const response = await GET(callbackRequest({ state, code: "one-time-code" }));
    const location = new URL(response.headers.get("location")!);

    expect(location.origin).toBe("https://app.test");
    expect(location.pathname).toBe("/settings/integrations");
  });
});

describe("safeReturnPath", () => {
  it("keeps safe same-origin relative paths", () => {
    expect(safeReturnPath("/dashboard")).toBe("/dashboard");
    expect(safeReturnPath("/settings/integrations?tab=github")).toBe(
      "/settings/integrations?tab=github",
    );
  });

  it("falls back for unsafe or non-relative values", () => {
    expect(safeReturnPath(null)).toBe("/settings/integrations");
    expect(safeReturnPath("")).toBe("/settings/integrations");
    expect(safeReturnPath("https://evil.com")).toBe("/settings/integrations");
    expect(safeReturnPath("//evil.com")).toBe("/settings/integrations");
    expect(safeReturnPath("/\\evil.com")).toBe("/settings/integrations");
    expect(safeReturnPath("\\/evil.com")).toBe("/settings/integrations");
  });

  it("falls back for URL-parser-stripped control characters", () => {
    expect(safeReturnPath("/\t/evil.com")).toBe("/settings/integrations");
    expect(safeReturnPath("/\n/evil.com")).toBe("/settings/integrations");
    expect(safeReturnPath("/\r/evil.com")).toBe("/settings/integrations");
    expect(safeReturnPath("/\x00evil")).toBe("/settings/integrations");
    expect(safeReturnPath("/\x7fevil")).toBe("/settings/integrations");
  });
});

describe("GitHub installation UI entry points", () => {
  it("routes repository recovery links through the signed install-start endpoint", () => {
    for (const returnTo of ["/dashboard", "/repositories?repo=repo_fixture"]) {
      const recovery = getRepositoryConnectionRecovery("github", "org_fixture", returnTo);
      const url = new URL(recovery.href, "https://app.test");
      expect(url.origin).toBe("https://app.test");
      expect(url.pathname).toBe("/api/github/install");
      expect(url.searchParams.get("orgId")).toBe("org_fixture");
      expect(url.searchParams.get("returnTo")).toBe(returnTo);
    }
  });

  it("redirects to integrations settings when no GitHub App is configured", async () => {
    githubAppConfigured = false;

    const response = await GET_INSTALL(
      installRequest({ orgId: "org_victim", returnTo: "/repositories" }),
    );
    const location = new URL(response.headers.get("location")!);

    expect(location.pathname).toBe("/settings/integrations");
    expect(location.searchParams.get("error")).toBe("github_app_not_configured");
  });

  it("records an install start with no organization selected instead of failing silently", async () => {
    const response = await GET_INSTALL(installRequest({ returnTo: "/repositories" }));
    const location = new URL(response.headers.get("location")!);

    expect(location.pathname).toBe("/dashboard");
    await Promise.resolve();
    expect(auditEntries()).toContainEqual(
      expect.objectContaining({
        action: "integration.install_failed",
        actorId: "user_victim",
        metadata: expect.objectContaining({ reason: "no_org_selected" }),
      }),
    );
  });

  it("resumes an unauthenticated install-start request after login", async () => {
    currentSession = null;

    const response = await GET_INSTALL(
      installRequest({ orgId: "org_victim", returnTo: "/repositories" }),
    );
    const location = new URL(response.headers.get("location")!);

    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("callbackUrl")).toBe(
      "/api/github/install?orgId=org_victim&returnTo=%2Frepositories",
    );
  });
});
