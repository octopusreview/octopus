import { assertDisposableIndexDatabase } from "./disposable-index-db";
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";

assertDisposableIndexDatabase();
mock.module("server-only", () => ({}));
mock.module("@/lib/queue", () => ({ enqueue: async () => null }));
mock.module("@/lib/elasticsearch", () => ({ deleteSyncLogs: async () => {}, writeSyncLog: () => {} }));
mock.module("@/lib/repository-index-notifications", () => ({ notifyRepositoryIndex: async () => {} }));
mock.module("../../background-failure", () => ({ reportBackgroundFailure: () => {} }));
for (const [path, names] of Object.entries({
  "forgejo-connector": ["cleanupForgejoConnectorRequests"], "emails/welcome": ["sendWelcomeEmail"],
  "large-review-result": ["handleLargeReviewResult"], "community-review": ["processCommunityReview"],
  audit: ["enforceAuditLogRetention", "enforceActivityEventRetention"], "webhook-tenant": ["enforceWebhookDeliveryRetention"],
  releases: ["refreshReleaseCache"], subscription: ["renewDueSubscriptions"], credits: ["reconcileAutoReloadAttempts"],
  "marketing-outbox": ["syncMarketingConversions"], "ollama-admin": ["runOllamaPull"],
  "discover-repositories": ["discoverRepositories"], "reap-stuck-reviews": ["reapStuckReviews"],
  reviewer: ["processReview"],
})) mock.module(`../../${path}`, () => Object.fromEntries(names.map(name => [name, () => { throw new Error("Unexpected unrelated job"); }])));

const { GitHubIndexDeferredError } = await import("../../github-index-fetch");
const { recordIndexRateLimit } = await import("../../github-index-rate-state");
const scenario = process.argv[2];
assert.ok(["success", "cancelled", "installation-replaced", "organization-transferred", "retry", "exhausted"].includes(scenario));
let calls = 0;
mock.module("@/lib/indexer", () => ({ indexRepository: async () => {
  calls++;
  if (calls === 1) {
    await recordIndexRateLimit("github-index-installation:123", 3_600_000);
    throw new GitHubIndexDeferredError(403);
  }
  if ((scenario === "retry" && calls === 2) || scenario === "exhausted") throw new Error("Synthetic index failure");
  return { totalFiles: 1, indexedFiles: 1, totalChunks: 1, totalVectors: 1,
    contributors: [], contributorCount: 0, durationMs: 10 };
} }));

const { prisma } = await import("@octopus/db");
const { processRepositoryIndex } = await import("../../repository-index-job");
const { dispatchDeferredIndexes } = await import("../../github-deferred-index");
const { registerWorkers } = await import("../../queue-workers");
const suffix = randomUUID();
const boss = new PgBoss(process.env.DATABASE_URL!);
const scope = "github-index-installation:123";
const org = await prisma.organization.create({ data: { name: "Synthetic", slug: `synthetic-${suffix}`, githubInstallationId: 123 } });
const repo = await prisma.repository.create({ data: { name: "Synthetic", fullName: "synthetic/repo", externalId: suffix,
  provider: "github", installationId: 123, organizationId: org.id, defaultBranch: "main", indexStatus: "pending" } });
let replacementOrgId: string | undefined;
await boss.start();
await boss.createQueue("index-repository", { retryLimit: 2, retryDelay: 0 });
try {
  await processRepositoryIndex({ repositoryId: repo.id, organizationId: org.id }, { retryCount: 0, retryLimit: 2 }, randomUUID());
  const failed = await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } });
  assert.equal(failed.indexStatus, "failed");
  assert.equal(failed.activeIndexGeneration, null);
  const deferred = await prisma.$queryRaw<Array<{ jobId: string; indexAttemptId: string }>>`
    SELECT "jobId", "indexAttemptId" FROM "github_deferred_indexes" WHERE "repositoryId" = ${repo.id}`;
  assert.equal(deferred.length, 1);
  assert.equal(deferred[0].indexAttemptId, failed.indexAttemptId);
  assert.equal(await dispatchDeferredIndexes(boss), 0, "no job should run inside the cooldown");
  assert.equal(await boss.getJobById("index-repository", deferred[0].jobId), null);

  await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${scope}`;
  assert.equal(await dispatchDeferredIndexes(boss), 1);
  assert.equal(await dispatchDeferredIndexes(boss), 0, "the deferred job is queued only once");
  const queued = await boss.getJobById<{ repositoryId: string; organizationId: string; expectedAttemptId: string }>("index-repository", deferred[0].jobId);
  assert.equal(queued?.state, "created");
  assert.equal(queued.data.expectedAttemptId, failed.indexAttemptId);
  if (scenario === "cancelled") {
    await prisma.repository.update({ where: { id: repo.id }, data: { indexStatus: "pending", indexAttemptId: null } });
  } else if (scenario === "installation-replaced") {
    await prisma.organization.update({ where: { id: org.id }, data: { githubInstallationId: 456 } });
  } else if (scenario === "organization-transferred") {
    const replacement = await prisma.organization.create({ data: { name: "Synthetic replacement", slug: `replacement-${suffix}`, githubInstallationId: 456 } });
    replacementOrgId = replacement.id;
    await prisma.repository.update({ where: { id: repo.id }, data: { organizationId: replacement.id, installationId: 456 } });
  }
  const observed: Array<{ id: string; retryCount: number; retryLimit: number }> = [];
  await registerWorkers({ work: async (name: string, ...args: unknown[]) => {
    if (name !== "index-repository") return "synthetic-unrelated-worker";
    const options = args[0] as { localConcurrency: number; includeMetadata: boolean };
    const callback = args[1] as (jobs: Array<{ id: string; retryCount: number; retryLimit: number }>) => Promise<void>;
    return boss.work(name, { ...options, pollingIntervalSeconds: 0.5 }, async jobs => {
      observed.push(...jobs.map(job => ({ id: job.id, retryCount: job.retryCount, retryLimit: job.retryLimit })));
      await callback(jobs);
    });
  } } as never, { reviewConcurrency: 1 } as never);
  const deadline = Date.now() + 15_000;
  let state: string | undefined;
  while (Date.now() < deadline) {
    state = (await boss.getJobById("index-repository", deferred[0].jobId))?.state;
    if (state === "completed" || state === "failed") break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(state, scenario === "exhausted" ? "failed" : "completed", "the actual registered pg-boss worker must settle the job");
  const attemptCount = scenario === "retry" ? 2 : scenario === "exhausted" ? 3 : 1;
  assert.deepEqual(observed, Array.from({ length: attemptCount }, (_, retryCount) => ({ id: deferred[0].jobId, retryCount, retryLimit: 2 })));
  const completed = await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } });
  if (scenario === "success" || scenario === "retry") {
    assert.equal(calls, scenario === "retry" ? 3 : 2);
    assert.equal(completed.indexStatus, "indexed");
    assert.ok(completed.activeIndexGeneration);
    assert.notEqual(completed.activeIndexGeneration, failed.indexAttemptId);
    assert.equal(completed.totalVectors, 1);
    assert.ok(completed.indexedAt);
  } else {
    assert.equal(calls, scenario === "exhausted" ? 4 : 1, "only an unsuperseded job may index");
    assert.equal(completed.indexStatus, scenario === "cancelled" ? "pending" : "failed");
    assert.equal(completed.activeIndexGeneration, null);
    assert.equal(completed.indexedAt, null);
    if (replacementOrgId) assert.equal(completed.organizationId, replacementOrgId);
  }
  assert.equal((await boss.getJobById("index-repository", deferred[0].jobId))?.state, scenario === "exhausted" ? "failed" : "completed");
  assert.equal((await prisma.$queryRaw<unknown[]>`SELECT 1 FROM "github_deferred_indexes" WHERE "repositoryId" = ${repo.id}`).length, 0);
  console.log(`PASS synthetic deferred queue recovery: ${scenario}`);
} finally {
  await boss.stop();
  await prisma.repository.deleteMany({ where: { id: repo.id } });
  await prisma.organization.deleteMany({ where: { id: { in: [org.id, ...(replacementOrgId ? [replacementOrgId] : [])] } } });
  await prisma.$executeRaw`DELETE FROM "github_index_rate_windows" WHERE "scope" = ${scope}`;
  await prisma.$disconnect();
}
