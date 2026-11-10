import { mock } from "bun:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";

mock.module("server-only", () => ({}));
const repo = {
  id: "repo-1", organizationId: "org-1", fullName: "acme/new",
  indexStatus: "indexed", totalChunks: 8, analysisStatus: "none", updatedAt: new Date(),
};
type Where = {
  id: string; organizationId: string; analysisStatus?: string;
  OR?: Array<{ analysisStatus: unknown; updatedAt?: { lt: Date } }>;
};
type Write = { where: Where; data: Record<string, unknown> };
const calls: string[] = [];
const notifications: string[] = [];
const emitted: unknown[] = [];
let failNotifications = false;
const writes: Write[] = [];
const queued: unknown[][] = [];
let failAt: "summary" | "analysis" | undefined;
let holdSummary: (() => Promise<void>) | undefined;
let prStatus = "reviewing";
let queueFailure = false;
mock.module("@octopus/db", () => ({
  prisma: {
    repository: {
      findFirst: async ({ where }: { where: Where }) =>
        where.id === repo.id && where.organizationId === repo.organizationId ? { ...repo } : null,
      updateMany: async (write: Write) => {
        assert.equal(write.where.id, repo.id);
        assert.equal(write.where.organizationId, repo.organizationId);
        const staleBefore = write.where.OR?.[1]?.updatedAt?.lt;
        if (write.data.analysisStatus === "analyzing" &&
            (repo.indexStatus !== "indexed" || repo.totalChunks === 0 || repo.analysisStatus === "analyzed" ||
              (repo.analysisStatus === "analyzing" && (!staleBefore || repo.updatedAt >= staleBefore)))) {
          return { count: 0 };
        }
        if (write.where.analysisStatus && repo.analysisStatus !== write.where.analysisStatus) return { count: 0 };
        Object.assign(repo, write.data, { updatedAt: new Date() });
        writes.push(write);
        return { count: 1 };
      },
      update: async (write: Write) => {
        assert.equal(write.where.organizationId, repo.organizationId);
        Object.assign(repo, write.data, { updatedAt: new Date() });
        writes.push(write);
        calls.push("persist-analysis");
        return repo;
      },
    },
    pullRequest: {
      updateMany: async ({ data, where }: { data: { status: string }; where: { headSha?: string | null } }) => {
        if (where.headSha !== undefined && where.headSha !== "current") return { count: 0 };
        prStatus = data.status; return { count: 1 };
      },
    },
  },
}));
mock.module("@/lib/summarizer", () => ({
  summarizeRepository: async (...args: unknown[]) => {
    assert.deepEqual(args, [repo.id, repo.fullName, repo.organizationId]);
    calls.push("summary");
    if (holdSummary) await holdSummary();
    if (failAt === "summary") throw new Error("Summary unavailable");
    return { summary: "Application summary", purpose: "Application purpose" };
  },
}));
mock.module("@/lib/analyzer", () => ({
  analyzeRepository: async (...args: unknown[]) => {
    assert.deepEqual(args, [repo.id, repo.fullName, repo.organizationId]);
    calls.push("analysis");
    if (failAt === "analysis") throw new Error("Analysis unavailable");
    return "Repository analysis";
  },
}));
mock.module("@/lib/pubby", () => ({ pubby: { trigger: async (_channel: string, event: string, data: { status?: string }) => { notifications.push(data.status ?? event); if (failNotifications) throw Object.assign(new Error("synthetic-private-response"), { status: 503, request_id: "req_syntheticprivate123" }); } } }));
mock.module("@/lib/events", () => ({ eventBus: { emit: (event: unknown) => { emitted.push(event); } } }));
mock.module("@/lib/queue", () => ({
  enqueueAfter: async (...args: unknown[]) => {
    assert.equal(prStatus, "pending", "deferred reviews must be claimable by the retry worker");
    queued.push(args);
    return queueFailure ? null : "job-1";
  },
}));
const { ensureRepositoryAnalysis, deferReviewForRepository } = await import("@/lib/review-repository-preparation");
const prepare = () => ensureRepositoryAnalysis(repo.id, repo.organizationId);

// Discovery already indexed this repository; the first review must still analyze it.
assert.equal(await prepare(), "ready");
assert.deepEqual(calls, ["summary", "analysis", "persist-analysis"]);
assert.equal(repo.analysisStatus, "analyzed");
assert.equal(writes.at(-1)?.data.analysis, "Repository analysis");
assert.ok(notifications.includes("repo-analyzed"));
assert.deepEqual(emitted.at(-1), { type: "repo-analyzed", orgId: repo.organizationId, repoFullName: repo.fullName });
calls.length = 0;
assert.equal(await prepare(), "ready");
assert.deepEqual(calls, [], "completed analysis should be reused on later reviews");

repo.analysisStatus = "none";
repo.indexStatus = "indexing";
assert.equal(await prepare(), "waiting");
assert.deepEqual(calls, [], "analysis must wait for the indexing worker");
repo.indexStatus = "indexed";
repo.totalChunks = 0;
assert.equal(await prepare(), "empty");
assert.equal(repo.analysisStatus, "none", "an empty base must not claim a completed AI analysis");
assert.deepEqual(calls, []);
repo.totalChunks = 8;

// Two first PRs must share a single analysis and wait until it is persisted.
let release!: () => void;
let started!: () => void;
const hasStarted = new Promise<void>((resolve) => { started = resolve; });
holdSummary = () => new Promise<void>((resolve) => { release = resolve; started(); });
const first = prepare();
await hasStarted;
assert.equal(await prepare(), "waiting");
assert.deepEqual(calls, ["summary"]);
release();
assert.equal(await first, "ready");
assert.equal(await prepare(), "ready");
assert.deepEqual(calls, ["summary", "analysis", "persist-analysis"]);
holdSummary = undefined;

for (const failure of ["summary", "analysis"] as const) {
  repo.analysisStatus = "none";
  failAt = failure;
  await assert.rejects(prepare, /unavailable/);
  assert.equal(repo.analysisStatus, "failed", "a failed analysis must release its claim for retry");
  assert.equal(repo.indexStatus, "indexed", "analysis failure must preserve the completed index");
  failAt = undefined;
  assert.equal(await prepare(), "ready");
}
const errors: unknown[][] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => { errors.push(args); };
try {
  failNotifications = true;
  repo.analysisStatus = "none";
  notifications.length = 0; emitted.length = 0;
  assert.equal(await prepare(), "ready");
  assert.equal(repo.analysisStatus, "analyzed");
  assert.deepEqual(notifications, ["analyzing", "analyzed", "repo-analyzed"]);
  assert.deepEqual(emitted, [{ type: "repo-analyzed", orgId: repo.organizationId, repoFullName: repo.fullName }]);
  repo.analysisStatus = "none"; failAt = "summary";
  notifications.length = 0;
  await assert.rejects(prepare, /Summary unavailable/);
  assert.equal(repo.analysisStatus, "failed");
  assert.deepEqual(notifications, ["analyzing", "failed"]);
  assert.equal(errors.length, 5);
  assert.match(inspect(errors), /503/);
  assert.doesNotMatch(inspect(errors, { depth: 20 }), /synthetic-private-response|req_syntheticprivate123/);
} finally { console.error = originalError; failNotifications = false; failAt = undefined; }
repo.analysisStatus = "analyzing";
repo.updatedAt = new Date(Date.now() - 36 * 60_000);
assert.equal(await prepare(), "ready", "an abandoned analysis should recover");
await assert.rejects(() => ensureRepositoryAnalysis(repo.id, "other-org"), /not found/);

await deferReviewForRepository("pr-1");
assert.deepEqual(queued, [["process-review", { pullRequestId: "pr-1" }, 30]]);
await deferReviewForRepository("pr-1", "stale");
assert.equal(queued.length, 1);
queueFailure = true;
await assert.rejects(() => deferReviewForRepository("pr-1"), /Could not enqueue/);
console.log("Analysis sequencing, empty bases, concurrency, retries and ownership checks passed");
