import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import crypto from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

process.env.BETTER_AUTH_URL = "https://app.test";
process.env.GITHUB_STATE_SECRET =
  "github-install-security-test-secret-32-bytes";

type Session = { user: { id: string } } | null;

let currentSession: Session = null;
let boundInstallationId: number | null = null;
let requestCookies = new Map<string, string>();
let installationAccessible = false;

const TEST_PRIVATE_KEY = crypto
  .generateKeyPairSync("rsa", { modulusLength: 1024 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();

const redisSet = mock(() => Promise.resolve("OK"));
const organizationUpdate = mock(
  ({ data }: { data: { githubInstallationId: number } }) => {
    boundInstallationId = data.githubInstallationId;
    return Promise.resolve({ id: "org_victim" });
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
  getRedis: () => ({ set: redisSet }),
}));

let githubAppConfigured = true;

mock.module("@/lib/github-app-config", () => ({
  getGithubAppConfig: () =>
    Promise.resolve(
      githubAppConfigured
        ? {
            appId: "123",
            slug: "octopus-review",
            privateKey: TEST_PRIVATE_KEY,
            clientId: "github-app-client-id",
            clientSecret: "github-app-client-secret",
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
      findUnique: () => Promise.resolve(null),
      update: organizationUpdate,
    },
    repository: {
      findMany: () => Promise.resolve([]),
      upsert: () => Promise.resolve({}),
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
  redisSet.mockClear();
  organizationUpdate.mockClear();
});

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
  const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  const repoTableSource = readFileSync(
    new URL("../../components/dashboard/repo-table.tsx", import.meta.url),
    "utf8",
  );
  const indexingLogsSource = readFileSync(
    new URL("../../components/indexing-logs.tsx", import.meta.url),
    "utf8",
  );
  const cliRepoStepSource = readFileSync(
    join(repoRoot, "apps/cli/src/steps/RepoStep.tsx"),
    "utf8",
  );

  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      if (
        entry.name.startsWith(".") ||
        entry.name === "node_modules" ||
        entry.name === "__tests__" ||
        /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)
      ) {
        return [];
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
    });
  }

  it("keeps raw GitHub App URLs inside the two server-owned redirect boundaries", () => {
    const rawInstallUrl = "https://github.com/apps/";
    const allowed = new Set([
      "apps/web/app/api/github/install/route.ts",
      "apps/web/app/api/github/app-manifest/callback/route.ts",
    ]);
    const sourceRoots = [join(repoRoot, "apps/web"), join(repoRoot, "apps/cli/src")];

    const violations = sourceRoots
      .flatMap(sourceFiles)
      .map((file) => ({
        file: relative(repoRoot, file).replaceAll("\\", "/"),
        source: readFileSync(file, "utf8"),
      }))
      .filter(({ file, source }) => source.includes(rawInstallUrl) && !allowed.has(file))
      .map(({ file }) => file);

    expect(violations).toEqual([]);
    for (const file of allowed) {
      expect(readFileSync(join(repoRoot, file), "utf8")).toContain(rawInstallUrl);
    }
  });

  it("routes web and CLI recovery links through the signed install-start endpoint", () => {
    expect(repoTableSource).toContain(
      'href={`/api/github/install?orgId=${encodeURIComponent(orgId)}&returnTo=${encodeURIComponent("/dashboard")}`}',
    );
    expect(indexingLogsSource).toContain(
      "href={`/api/github/install?orgId=${encodeURIComponent(orgId)}&returnTo=${encodeURIComponent(`/repositories?repo=${repoId}`)}`}",
    );
    expect(cliRepoStepSource).toContain(
      "`${creds.baseUrl}/api/github/install?orgId=${encodeURIComponent(creds.orgId)}&returnTo=${encodeURIComponent(\"/repositories\")}`",
    );
  });

  it("does not hide signed recovery links behind a public app-slug gate", () => {
    expect(repoTableSource).not.toContain("githubAppSlug");
    expect(indexingLogsSource).not.toContain("NEXT_PUBLIC_GITHUB_APP_SLUG");
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
