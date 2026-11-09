import { mock } from "bun:test";
import assert from "node:assert/strict";

const db = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["postgres:", "postgresql:"].includes(db.protocol));
assert.ok(["localhost", "127.0.0.1"].includes(db.hostname));
assert.match(db.pathname.slice(1), /(^|[-_])test($|[-_])/);
assert.equal(db.search + db.hash, "");
mock.module("server-only", () => ({}));
const { prisma } = await import("@octopus/db");
const { githubIndexFetch, GitHubIndexDeferredError } = await import("../../github-index-fetch");
const { admitIndexRequest, recordIndexRateLimit } = await import("../../github-index-rate-state");
const scope = "github-index-installation:123";
const other = "github-index-installation:456";
const cancelScope = "github-index-installation:789";
const url = "https://api.github.invalid/synthetic";
let calls = 0;
let response = () => new Response(null, { status: 403, headers: {
  "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
} });
globalThis.fetch = (async () => { calls++; return response(); }) as typeof fetch;

try {
  await prisma.$executeRaw`DELETE FROM "github_index_rate_windows"`;
  await assert.rejects(githubIndexFetch(scope, url), GitHubIndexDeferredError);
  await assert.rejects(githubIndexFetch(scope, url), GitHubIndexDeferredError);
  assert.equal(calls, 1, "a second worker must not request GitHub during the cooldown");
  response = () => new Response(null, { status: 200 });
  assert.equal((await githubIndexFetch(other, url)).status, 200, "unrelated scope remains available");
  assert.equal(calls, 2);

  await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${scope}`;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let allBlocked!: () => void;
  const blocked = new Promise<void>(resolve => { allBlocked = resolve; });
  let blockedCount = 0;
  globalThis.fetch = (async () => { calls++; await gate; return new Response(null, { status: 200 }); }) as typeof fetch;
  const attempts = Promise.allSettled(Array.from({ length: 8 }, () => githubIndexFetch(scope, url).catch((error: unknown) => {
    if (error instanceof GitHubIndexDeferredError && ++blockedCount === 7) allBlocked();
    throw error;
  })));
  let guard!: ReturnType<typeof setTimeout>;
  try { await Promise.race([blocked, new Promise((_, reject) => { guard = setTimeout(() => reject(new Error("workers did not defer")), 5000); })]); }
  finally { clearTimeout(guard); release(); }
  const results = await attempts;
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(calls, 3, "only the leased worker makes a recovery request");
  assert.equal((await githubIndexFetch(scope, url)).status, 200, "a successful probe reopens the scope");

  globalThis.fetch = (async () => { calls++; return new Response(null, { status: 403 }); }) as typeof fetch;
  assert.equal((await githubIndexFetch(other, url)).status, 403, "an unmarked 403 remains unclassified");
  assert.deepEqual(await admitIndexRequest(other), { kind: "open" });
  await recordIndexRateLimit(other, 1000);
  await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${other}`;
  globalThis.fetch = (async () => { calls++; return new Response(null, { status: 503 }); }) as typeof fetch;
  await assert.rejects(githubIndexFetch(other, url), GitHubIndexDeferredError);
  assert.equal((await admitIndexRequest(other)).kind, "blocked", "a failed probe cannot clear the window");

  response = () => new Response(null, { status: 200, headers: {
    "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
  } });
  globalThis.fetch = (async () => { calls++; return response(); }) as typeof fetch;
  assert.equal((await githubIndexFetch(scope, url)).status, 200, "the response that consumed the last request stays usable");
  await assert.rejects(githubIndexFetch(scope, url), GitHubIndexDeferredError);
  const afterLimit = calls;
  const controller = new AbortController();
  const reason = new DOMException("synthetic cancellation", "AbortError");
  controller.abort(reason);
  await assert.rejects(githubIndexFetch(other, url, { signal: controller.signal }), error => error === reason);
  assert.equal(calls, afterLimit);
  await assert.rejects(githubIndexFetch("raw-token", url), /GitHub indexing temporarily unavailable/);
  assert.equal(calls, afterLimit, "a state failure must fail closed");

  await recordIndexRateLimit(cancelScope, 1000);
  await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${cancelScope}`;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const duringProbe = new AbortController();
  globalThis.fetch = ((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
    entered();
    init?.signal?.addEventListener("abort", () => reject(new Error("private synthetic request details")), { once: true });
  })) as typeof fetch;
  const cancelled = githubIndexFetch(cancelScope, url, { signal: duringProbe.signal });
  await started;
  duringProbe.abort(reason);
  await assert.rejects(cancelled, error => error === reason);
  assert.equal((await admitIndexRequest(cancelScope)).kind, "blocked", "cancelled probes do not reopen the scope");
} finally {
  await prisma.$executeRaw`DELETE FROM "github_index_rate_windows"`;
  await prisma.$disconnect();
}
