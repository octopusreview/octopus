import { mock } from "bun:test";
import assert from "node:assert/strict";

mock.module("server-only", () => ({}));
const sentryEvents: Array<{ tags?: Record<string, unknown>; contexts?: Record<string, Record<string, unknown>> }> = [];
mock.module("@sentry/nextjs", () => ({ captureEvent: (event: typeof sentryEvents[number]) => { sentryEvents.push(event); return "e".repeat(32); } }));
const row = {
  id: "repo-1", provider: "github", organizationId: "org-1", fullName: "acme/new", defaultBranch: "main",
  installationId: 123, indexStatus: "pending", totalFiles: 0,
  indexAttemptId: null as string | null, indexedAt: null as Date | null, firstIndexedAt: null as Date | null,
  organization: { githubInstallationId: 123 as number | null },
};
let currentRow: typeof row | null = row;
let claimCount = 1;
let indexFailure: Error | null = null;
let cancelled = false;
let timedOut = false;
let timeoutCallback: (() => void) | undefined;
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((callback: () => void, ms?: number, ...args: unknown[]) => {
  if (ms === 25 * 60_000) timeoutCallback = callback;
  return realSetTimeout(callback, ms, ...args);
}) as typeof setTimeout;
let populated = false;
let preparationFailure = false;
let replaceAttempt = false;
let transactionActive = false;
let transactions = 0;
const notifications: string[] = [];
const queued: unknown[][] = [];
const indexCalls: unknown[][] = [];
const writes: Array<{ data: Record<string, unknown> }> = [];
const queries: Array<{ where: Record<string, unknown> }> = [];
const claims: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
let controller = new AbortController();
mock.module("@/lib/queue", () => ({
  enqueue: async (...args: unknown[]) => { queued.push(args); return "job-1"; },
}));
mock.module("@/lib/indexing-abort", () => ({
  createAbortController: () => { controller = new AbortController(); return controller; },
  clearAbortController: () => {},
}));
const update = async (args: { where: { id?: string; indexStatus?: string; indexAttemptId?: string; OR?: unknown[] }; data: Record<string, unknown> }) => {
  (transactionActive ? writes : claims).push(args);
  if (!claimCount || !currentRow || (args.where.id && args.where.id !== currentRow.id)
    || (typeof args.where.indexStatus === "string" && args.where.indexStatus !== currentRow.indexStatus)
    || (args.where.indexAttemptId !== undefined && args.where.indexAttemptId !== currentRow.indexAttemptId)) return { count: 0 };
  if (args.where.OR && !(["pending", "failed"].includes(currentRow.indexStatus) || (currentRow.indexStatus === "indexed" && currentRow.totalFiles === 0))) return { count: 0 };
  Object.assign(currentRow, args.data);
  return { count: 1 };
};
const db = {
  $executeRaw: async (_strings: TemplateStringsArray, completedAt: Date) => {
    assert.ok(transactionActive);
    assert.ok(currentRow);
    if (!currentRow.indexedAt) currentRow.firstIndexedAt = completedAt;
    currentRow.indexedAt = completedAt;
    return 1;
  },
  $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
    const before = structuredClone(currentRow);
    transactionActive = true;
    transactions++;
    try { return await run(db); }
    catch (error) { Object.assign(currentRow!, before); throw error; }
    finally { transactionActive = false; }
  },
  repository: {
    findUniqueOrThrow: async () => ({ ...currentRow }),
    findMany: async (args: { where: Record<string, unknown> }) => { queries.push(args); return [{ id: "repo-1" }]; },
    findFirst: async (args: { where: Record<string, unknown> }) => { queries.push(args); return currentRow ? { ...currentRow } : null; },
    updateMany: update,
  },
};
mock.module("@octopus/db", () => ({ prisma: db }));
mock.module("@/lib/pubby", () => ({ pubby: { trigger: async () => { notifications.push(currentRow!.indexStatus); } } }));
mock.module("@/lib/elasticsearch", () => ({ writeSyncLog: () => {}, deleteSyncLogs: async () => {
  assert.ok(currentRow?.indexAttemptId);
  if (preparationFailure) throw new Error("Index setup failed");
} }));
mock.module("@/lib/indexer", () => ({
  indexRepository: async (...args: unknown[]) => {
    indexCalls.push(args);
    if (cancelled) { controller.abort(); throw controller.signal.reason; }
    if (timedOut) { assert.ok(timeoutCallback); timeoutCallback(); throw new Error("Indexing cancelled"); }
    if (replaceAttempt) {
      Object.assign(currentRow!, { indexStatus: "indexing", indexAttemptId: "replacement" });
      throw new Error("Old worker failed after replacement");
    }
    if (indexFailure) throw indexFailure;
    return {
      indexedFiles: populated ? 1 : 0, totalFiles: populated ? 1 : 0, totalChunks: populated ? 1 : 0, totalVectors: populated ? 1 : 0,
      contributors: [], contributorCount: 0, durationMs: 12, resolvedDefaultBranch: "master",
    };
  },
}));
const { enqueuePendingRepositoryIndexes, processRepositoryIndex } = await import("@/lib/repository-index-job");
const job = { repositoryId: "repo-1", organizationId: "org-1" };

await assert.rejects(() => processRepositoryIndex({ repositoryId: "repo-1", organizationId: "" }), /requires/);
assert.equal(queries.length, 0, "invalid jobs must never issue an unscoped query");

await enqueuePendingRepositoryIndexes("org-1");
assert.deepEqual(queued, [["index-repository", job, { singletonKey: "repo-1", singletonSeconds: 60 }]]);
assert.deepEqual(queries[0].where, {
  organizationId: "org-1", provider: { in: ["github", "forgejo"] }, isActive: true, dismissedAt: null,
  organization: { deletedAt: null, bannedAt: null, autoDiscoverRepos: true },
  OR: [{ indexStatus: { in: ["pending", "failed"] } }, { indexStatus: "indexed", totalFiles: 0 }],
});

await processRepositoryIndex(job);
assert.equal(indexCalls.length, 1);
assert.equal(indexCalls[0][3], 123, "the worker must use the org's bound installation");
assert.equal(writes[0].data.indexStatus, "indexed");
assert.equal(writes[0].data.defaultBranch, "master");
assert.equal(writes[0].data.totalFiles, 0, "an empty base must be a completed snapshot");
assert.equal(queries[1].where.organizationId, "org-1");
assert.equal(queries[1].where.dismissedAt, null);
assert.equal(queries[1].where.isActive, true);
assert.deepEqual(queries[1].where.organization, { deletedAt: null, bannedAt: null, autoDiscoverRepos: true });

claimCount = 0;
await processRepositoryIndex(job);
assert.equal(indexCalls.length, 1, "a competing review must keep its claim");
claimCount = 1;
currentRow = null;
await processRepositoryIndex(job);
assert.equal(indexCalls.length, 1, "removed or wrong-tenant rows must be skipped");
currentRow = { ...row, organization: { githubInstallationId: null } };
await processRepositoryIndex(job);
currentRow = { ...row, organization: { githubInstallationId: 456 } };
await processRepositoryIndex(job);
assert.equal(indexCalls.length, 1, "disconnected or mismatched installations must not index");

currentRow = row;
indexFailure = new Error("GitHub unavailable");
await assert.rejects(() => processRepositoryIndex(job, { retryCount: 0, retryLimit: 2 }), /GitHub unavailable/);
assert.equal(sentryEvents.length, 0, "a scheduled retry is not a terminal failure");
await assert.rejects(() => processRepositoryIndex(job, { retryCount: 2, retryLimit: 2 }), /GitHub unavailable/);
assert.equal(sentryEvents.length, 1);
assert.equal(sentryEvents[0].tags?.failure_stage, "indexing");
assert.equal(claims.at(-1)?.data.indexStatus, "failed", "failures must release the claim for retry");
indexFailure = null;
await processRepositoryIndex(job);
assert.equal(writes.length, 2, "a retry must be able to complete");

currentRow = { ...row, provider: "forgejo", organization: { githubInstallationId: null } };
await processRepositoryIndex(job);
assert.equal(indexCalls.at(-1)?.[3], 0);
assert.equal(indexCalls.at(-1)?.[6], "forgejo", "Forgejo jobs must not use GitHub authentication");

cancelled = true;
const beforeCancellation = sentryEvents.length;
await processRepositoryIndex(job);
assert.equal(sentryEvents.length, beforeCancellation, "cancelled work is not a platform incident");
assert.equal(claims.at(-1)?.data.indexStatus, "pending", "cancelled work must release its claim");
assert.equal(notifications.at(-1), "pending");
cancelled = false;
timedOut = true;
const beforeTimeout = sentryEvents.length;
await assert.rejects(() => processRepositoryIndex(job, { retryCount: 1, retryLimit: 2 }), { name: "TimeoutError" });
assert.equal(sentryEvents.length, beforeTimeout);
await assert.rejects(() => processRepositoryIndex(job, { retryCount: 2, retryLimit: 2 }), { name: "TimeoutError" });
assert.equal(sentryEvents.length, beforeTimeout + 1);
assert.equal(sentryEvents.at(-1)?.contexts?.background_failure?.name, "TimeoutError");
assert.equal(sentryEvents.at(-1)?.tags?.indexing_deadline, "worker_25m");
assert.equal(sentryEvents.at(-1)?.contexts?.background_failure?.attemptId, currentRow?.indexAttemptId);
assert.equal(sentryEvents.at(-1)?.contexts?.background_failure?.retryCount, 2);
assert.equal(currentRow?.indexStatus, "failed");
assert.equal(notifications.at(-1), "failed");
assert.equal(currentRow?.firstIndexedAt, null);
timedOut = false;
indexFailure = new DOMException("other timeout", "TimeoutError");
await assert.rejects(() => processRepositoryIndex(job, { retryCount: 2, retryLimit: 2 }), { name: "TimeoutError" });
assert.equal(sentryEvents.at(-1)?.tags?.indexing_deadline, undefined, "a dependency timeout must not be labeled as the worker deadline");
indexFailure = null;
const priorQueries = queries.length;
await enqueuePendingRepositoryIndexes("org-1", undefined, ["bitbucket", "gitlab", "unrecognized"]);
assert.equal(queries.length, priorQueries, "provider-scoped setup must not expand the indexing allowlist");
await enqueuePendingRepositoryIndexes("org-1", undefined, ["forgejo", "bitbucket"]);
assert.deepEqual(queries.at(-1)?.where.provider, { in: ["forgejo"] }, "a retry must not index a different provider");
cancelled = false;
populated = true;
await processRepositoryIndex(job);
assert.ok(currentRow?.firstIndexedAt);
assert.equal(currentRow?.indexedAt, currentRow?.firstIndexedAt);
assert.ok(transactions > 0);
const firstDate = currentRow?.firstIndexedAt;
preparationFailure = true;
currentRow!.indexStatus = "pending";
const beforeFailure = indexCalls.length;
await assert.rejects(() => processRepositoryIndex(job), /Index setup failed/);
assert.equal(indexCalls.length, beforeFailure);
assert.equal(currentRow?.indexStatus, "failed");
assert.equal(currentRow?.firstIndexedAt, firstDate);
preparationFailure = false;
replaceAttempt = true;
notifications.length = 0;
await processRepositoryIndex(job);
assert.equal(currentRow?.indexStatus, "indexing");
assert.equal(currentRow?.indexAttemptId, "replacement");
assert.deepEqual(notifications, ["indexing"]);
globalThis.setTimeout = realSetTimeout;
console.log("Repository queue, tenant, claim, empty snapshot, failure, retry and cancellation checks passed");
