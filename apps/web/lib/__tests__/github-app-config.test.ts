import { describe, it, expect, mock, beforeEach } from "bun:test";

mock.module("server-only", () => ({}));

// Mutable SystemConfig row the mocked prisma returns.
let sysRow: Record<string, unknown> | null = null;
mock.module("@octopus/db", () => ({
  prisma: {
    systemConfig: { findUnique: () => Promise.resolve(sysRow) },
  },
}));

const { getGithubAppConfig, clearGithubAppConfigCache, assertGithubAppVerificationConfig } =
  await import("@/lib/github-app-config");

// decryptStringMaybeLegacy returns its input unchanged when the value isn't
// valid ciphertext, so plaintext test values round-trip without a data key.
const ENV = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "NEXT_PUBLIC_GITHUB_APP_SLUG",
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
];

beforeEach(() => {
  sysRow = null;
  clearGithubAppConfigCache();
  for (const k of ENV) delete process.env[k];
});

describe("getGithubAppConfig", () => {
  it("prefers a DB-configured app over env", async () => {
    sysRow = {
      githubAppId: "999",
      githubAppSlug: "octopus-db",
      githubAppClientId: "cid-db",
      githubAppHtmlUrl: "https://github.com/apps/octopus-db",
      githubAppPrivateKeyEnc: "PEM-DB",
      githubAppWebhookSecretEnc: "WH-DB",
      githubAppClientSecretEnc: "CS-DB",
    };
    process.env.GITHUB_APP_ID = "111";
    process.env.GITHUB_APP_PRIVATE_KEY = "PEM-ENV";
    process.env.NEXT_PUBLIC_GITHUB_APP_SLUG = "octopus-env";

    const c = await getGithubAppConfig();
    expect(c?.appId).toBe("999");
    expect(c?.slug).toBe("octopus-db");
    expect(c?.privateKey).toBe("PEM-DB");
    expect(c?.webhookSecret).toBe("WH-DB");
    expect(c?.clientId).toBe("cid-db");
    expect(c?.clientSecret).toBe("CS-DB");
    expect(c?.htmlUrl).toBe("https://github.com/apps/octopus-db");
  });

  it("falls back to env when there is no DB app", async () => {
    sysRow = null;
    process.env.GITHUB_APP_ID = "111";
    process.env.GITHUB_APP_PRIVATE_KEY = "PEM-ENV";
    process.env.GITHUB_WEBHOOK_SECRET = "WH-ENV";
    process.env.NEXT_PUBLIC_GITHUB_APP_SLUG = "octopus-env";
    process.env.GITHUB_APP_CLIENT_ID = "cid-env";
    process.env.GITHUB_APP_CLIENT_SECRET = "cs-env";

    const c = await getGithubAppConfig();
    expect(c?.appId).toBe("111");
    expect(c?.slug).toBe("octopus-env");
    expect(c?.privateKey).toBe("PEM-ENV");
    expect(c?.webhookSecret).toBe("WH-ENV");
    expect(c?.clientId).toBe("cid-env");
    expect(c?.clientSecret).toBe("cs-env");
    expect(c?.htmlUrl).toBeNull();
  });

  it("ignores a partial DB row (id without key) and uses env", async () => {
    sysRow = { githubAppId: "999", githubAppPrivateKeyEnc: null };
    process.env.GITHUB_APP_ID = "111";
    process.env.GITHUB_APP_PRIVATE_KEY = "PEM-ENV";
    const c = await getGithubAppConfig();
    expect(c?.appId).toBe("111");
  });

  it("returns null when neither DB nor env is configured", async () => {
    sysRow = null;
    expect(await getGithubAppConfig()).toBeNull();
  });
});

describe("assertGithubAppVerificationConfig", () => {
  const full = { clientId: "cid", clientSecret: "cs" };

  it("accepts no GitHub App at all (Connect is simply hidden)", () => {
    expect(() => assertGithubAppVerificationConfig({ selfHosted: false, appConfig: null })).not.toThrow();
  });

  it("accepts an App with both client credentials", () => {
    expect(() => assertGithubAppVerificationConfig({ selfHosted: false, appConfig: full })).not.toThrow();
  });

  it("refuses to boot cloud with an App but no client secret", () => {
    expect(() =>
      assertGithubAppVerificationConfig({
        selfHosted: false,
        appConfig: { clientId: "cid", clientSecret: null },
      }),
    ).toThrow(/GITHUB_APP_CLIENT_ID \/ GITHUB_APP_CLIENT_SECRET.*github_verification_not_configured/);
  });

  it("refuses to boot cloud with an App but no client id", () => {
    expect(() =>
      assertGithubAppVerificationConfig({
        selfHosted: false,
        appConfig: { clientId: null, clientSecret: "cs" },
      }),
    ).toThrow();
  });

  it("only logs on self-host so an operator mid-setup can still start", () => {
    const original = console.error;
    const calls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      calls.push(args);
    };
    try {
      expect(() =>
        assertGithubAppVerificationConfig({
          selfHosted: true,
          appConfig: { clientId: "cid", clientSecret: null },
        }),
      ).not.toThrow();
    } finally {
      console.error = original;
    }
    expect(calls).toHaveLength(1);
    expect(String(calls[0][0])).toContain("GITHUB_APP_CLIENT_ID");
  });

  it("is wired into instrumentation before the queue starts", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../../instrumentation.ts", import.meta.url), "utf8");
    const assertAt = source.indexOf("assertGithubAppVerificationConfig({");
    const queueAt = source.indexOf("startQueue()");
    expect(assertAt).toBeGreaterThan(-1);
    expect(queueAt).toBeGreaterThan(assertAt);
  });
});
