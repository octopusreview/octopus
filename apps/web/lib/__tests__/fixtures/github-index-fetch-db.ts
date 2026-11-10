import { assertDisposableIndexDatabase } from "./disposable-index-db";
import { mock } from "bun:test";
import assert from "node:assert/strict";

assertDisposableIndexDatabase();
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
  date: new Date().toUTCString(), "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
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
  globalThis.fetch = (async () => { calls++; return Response.json({ message: "You have exceeded a secondary rate limit." }, { status: 403 }); }) as typeof fetch;
  await assert.rejects(githubIndexFetch(other, url), GitHubIndexDeferredError);
  assert.equal((await admitIndexRequest(other)).kind, "blocked", "message-only secondary limits coordinate workers");
  await prisma.$executeRaw`DELETE FROM "github_index_rate_windows" WHERE "scope" = ${other}`;
  await recordIndexRateLimit(other, 1000);
  await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${other}`;
  globalThis.fetch = (async () => { calls++; return new Response(null, { status: 503 }); }) as typeof fetch;
  await assert.rejects(githubIndexFetch(other, url), GitHubIndexDeferredError);
  assert.equal((await admitIndexRequest(other)).kind, "blocked", "a failed probe cannot clear the window");

  response = () => new Response(null, { status: 200, headers: {
    date: new Date().toUTCString(), "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
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

  const explicitScope = "github-index-installation:790";
  globalThis.fetch = (async () => { calls++; return new Response(null, { status: 429, headers: { "retry-after": "0" } }); }) as typeof fetch;
  for (let i = 0; i < 7; i++) {
    await assert.rejects(githubIndexFetch(explicitScope, url), GitHubIndexDeferredError);
    await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${explicitScope}`;
  }
  const beforePaused = calls;
  await assert.rejects(githubIndexFetch(explicitScope, url), (error: unknown) => error instanceof GitHubIndexDeferredError && error.paused);
  assert.equal(calls, beforePaused, "repeated explicit secondary limits stop automatic requests");

  for (const [offset, variant] of ["primary-no-reset", "primary-no-date"].entries()) {
    const unknownScope = `github-index-installation:${801 + offset}`;
    const base = Date.parse("2026-01-01T12:00:00Z");
    const sourceReset = base + 7_200_000;
    let currentServerTime = base + 60_000;
    let quotaReset = base + 3_600_000;
    let withDate = false, recovered = false, originalCalls = 0, quotaCalls = 0;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const target = String(input);
      if (target === "https://api.github.com/rate_limit") {
        quotaCalls++;
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-private-token");
        assert.equal(init?.redirect, "error");
        return Response.json({ resources: { core: { remaining: 10, reset: quotaReset / 1000 } } },
          { headers: withDate ? { date: new Date(currentServerTime).toUTCString() } : {} });
      }
      assert.equal(target, url);
      originalCalls++;
      if (recovered) return new Response(null, { status: 200 });
      const headers: Record<string, string> = { "x-ratelimit-remaining": "0" };
      if (variant === "primary-no-date") headers["x-ratelimit-reset"] = String(sourceReset / 1000);
      return new Response(null, { status: 403, headers });
    }) as typeof fetch;
    const options = { headers: { authorization: "Bearer synthetic-private-token" } };
    await assert.rejects(githubIndexFetch(unknownScope, url, options), GitHubIndexDeferredError);
    await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${unknownScope}`;
    await assert.rejects(githubIndexFetch(unknownScope, url, options), GitHubIndexDeferredError);
    assert.equal(originalCalls, 1, "a quota response without trusted time cannot reopen the original endpoint");
    withDate = true;
    await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${unknownScope}`;
    await assert.rejects(githubIndexFetch(unknownScope, url, options), GitHubIndexDeferredError);
    const targetReset = variant === "primary-no-reset" ? quotaReset : sourceReset;
    currentServerTime = targetReset - 1000;
    quotaReset = targetReset + 3_600_000;
    await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${unknownScope}`;
    await assert.rejects(githubIndexFetch(unknownScope, url, options), GitHubIndexDeferredError);
    assert.equal(originalCalls, 1, "the original endpoint stays closed before the conservative reset boundary");
    currentServerTime = targetReset + 1000;
    recovered = true;
    await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${unknownScope}`;
    assert.equal((await githubIndexFetch(unknownScope, url, options)).status, 200);
    assert.equal(originalCalls, 2);
    assert.equal(quotaCalls, 4);
  }

  const quotaHoldScope = "github-index-installation:819";
  await recordIndexRateLimit(quotaHoldScope, 1000, false, { resetMs: null });
  await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${quotaHoldScope}`;
  let quotaHoldCalls = 0;
  globalThis.fetch = (async () => {
    quotaHoldCalls++;
    return new Response(null, { status: 200, headers: {
      "x-ratelimit-remaining": "0", "retry-after": "Fri, 02 Jan 2026 12:00:00 GMT",
    } });
  }) as typeof fetch;
  const quotaOptions = { headers: { authorization: "Bearer synthetic-private-token" } };
  await assert.rejects(githubIndexFetch(quotaHoldScope, url, quotaOptions), (error: unknown) =>
    error instanceof GitHubIndexDeferredError && error.paused && error.message.includes("deadline could not be verified"));
  await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${quotaHoldScope}`;
  await assert.rejects(githubIndexFetch(quotaHoldScope, url, quotaOptions, true), GitHubIndexDeferredError);
  assert.equal(quotaHoldCalls, 1, "an untrusted quota deadline blocks even manual recovery probes");

  for (const [offset, primary] of [false, true].entries()) {
    const heldScope = `github-index-installation:${820 + offset}`;
    let requests = 0;
    globalThis.fetch = (async () => {
      requests++;
      return new Response(null, { status: primary ? 403 : 429, headers: {
        "retry-after": "Fri, 02 Jan 2026 12:00:00 GMT",
        ...(primary ? { "x-ratelimit-remaining": "0" } : {}),
      } });
    }) as typeof fetch;
    const options = { headers: { authorization: "Bearer synthetic-private-token" } };
    await assert.rejects(githubIndexFetch(heldScope, url, options), GitHubIndexDeferredError);
    await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${heldScope}`;
    await assert.rejects(githubIndexFetch(heldScope, url, options, true), (error: unknown) => error instanceof GitHubIndexDeferredError && error.paused && error.message.includes("deadline could not be verified"));
    const cancelled = new AbortController();
    cancelled.abort(reason);
    await assert.rejects(githubIndexFetch(heldScope, url, { ...options, signal: cancelled.signal }, true), error => error === reason);
    assert.equal(requests, 1, "an untrusted absolute deadline cannot trigger any provider probe, including a manual retry");
  }

  for (const [offset, mode] of ["malformed", "oversized", "conflicting-header", "missing-authorization"].entries()) {
    const invalidScope = `github-index-installation:${810 + offset}`;
    let originalCalls = 0, quotaCalls = 0;
    const base = Date.parse("2026-01-01T12:00:00Z");
    globalThis.fetch = (async (input: string | URL | Request) => {
      if (String(input) !== "https://api.github.com/rate_limit") {
        originalCalls++;
        return new Response(null, { status: 403, headers: { "x-ratelimit-remaining": "0" } });
      }
      quotaCalls++;
      const headers: Record<string, string> = { date: new Date(base).toUTCString() };
      if (mode === "conflicting-header") {
        headers["x-ratelimit-remaining"] = "0";
        headers["x-ratelimit-reset"] = String(base / 1000 + 3600);
      }
      if (mode === "oversized") return new Response("x".repeat(65_537), { headers });
      return Response.json({ resources: { core: { remaining: mode === "malformed" ? true : 10, reset: base / 1000 + 3600 } } }, { headers });
    }) as typeof fetch;
    const options = mode === "missing-authorization" ? {} : { headers: { authorization: "Bearer synthetic-private-token" } };
    await assert.rejects(githubIndexFetch(invalidScope, url, options), GitHubIndexDeferredError);
    await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${invalidScope}`;
    await assert.rejects(githubIndexFetch(invalidScope, url, options), GitHubIndexDeferredError);
    assert.equal(originalCalls, 1, `${mode} must fail closed`);
    assert.equal(quotaCalls, mode === "missing-authorization" ? 0 : 1);
  }
} finally {
  await prisma.$executeRaw`DELETE FROM "github_index_rate_windows"`;
  await prisma.$disconnect();
}
