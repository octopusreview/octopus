import { mock } from "bun:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";

mock.module("server-only", () => ({}));
const integration = { accessToken: "fake-token", tokenExpiresAt: new Date(Date.now() + 3600000), gitlabHost: "https://synthetic-host.invalid" };
mock.module("@octopus/db", () => ({ prisma: { gitlabIntegration: { findUnique: async () => integration }, bitbucketIntegration: { findUnique: async () => integration } } }));
mock.module("@/lib/crypto", () => ({ decryptStringMaybeLegacy: (value: string) => value, decryptString: (value: string) => value, encryptString: (value: string) => value }));
const gitlab = await import("@/lib/gitlab");
const bitbucket = await import("@/lib/bitbucket");
const oldFetch = globalThis.fetch;
const oldWarn = console.warn;
const oldTimeout = globalThis.setTimeout;
const logs: unknown[][] = [];
console.warn = (...args: unknown[]) => { logs.push(args); };
globalThis.setTimeout = ((callback: TimerHandler, ms?: number, ...args: unknown[]) => oldTimeout(callback, ms === 1000 || ms === 2000 ? 0 : ms, ...args)) as typeof setTimeout;
try {
  for (const provider of ["gitlab", "bitbucket"] as const) {
    const run = () => provider === "gitlab" ? gitlab.getRepositoryTree("org", "private-project", "private-branch") : bitbucket.getRepositoryTree("org", "private-project", "repo", "private-branch");
    for (const kind of ["exception", "http"] as const) {
      let calls = 0;
      logs.length = 0;
      globalThis.fetch = (async () => {
        calls++;
        if (kind === "exception") throw Object.assign(new Error("synthetic-private-error"), { status: 503, code: "ECONNRESET", request_id: "req_syntheticprivate123" });
        return new Response("synthetic-private-error", { status: 503 });
      }) as typeof fetch;
      assert.deepEqual(await run(), []);
      assert.equal(calls, kind === "exception" ? 3 : 1);
      assert.equal(logs.length, 1);
      const output = inspect(logs, { depth: 10 });
      assert.match(output, /503/);
      if (kind === "exception") assert.match(output, /ECONNRESET/);
      assert.doesNotMatch(output, /private-project|private-branch|synthetic-host|synthetic-private-error|req_syntheticprivate123/);
    }
  }
} finally { globalThis.fetch = oldFetch; console.warn = oldWarn; globalThis.setTimeout = oldTimeout; }
