import { mock } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { localQueueTestDatabaseUrl } from "../queue-test-database";

// Drives the real community review worker against disposable PostgreSQL. Only the
// external boundaries (model, GitHub, indexing, posting, token decryption) are mocked.
process.env.DATABASE_URL = localQueueTestDatabaseUrl(process.env.DATABASE_URL);
mock.module("server-only", () => ({}));
globalThis.fetch = (() => { throw new Error("unexpected external request"); }) as typeof fetch;
const { prisma } = await import("@octopus/db");
const suffix = randomUUID();
const source = await prisma.organization.create({ data: { name: "Source", slug: `community-flow-source-${suffix}` } });
const target = await prisma.organization.create({ data: { name: "Target", slug: `community-flow-target-${suffix}` } });
const repo = await prisma.repository.create({ data: { organizationId: source.id, name: "Synthetic", fullName: `synthetic/${suffix}`, externalId: suffix, provider: "github", indexStatus: "indexed" } });
const finding = { severity: "🟠", title: "Synthetic finding", filePath: "file.ts", startLine: 1, endLine: 1,
  category: "synthetic", description: "Synthetic description", suggestion: "Synthetic suggestion", confidence: 1 };
let run = 0;
let treeRequests = 0;
let indexRequests = 0;
let summaryRequests = 0;
let analysisRequests = 0;
let duringIndex: () => Promise<void> = async () => {};
let duringSummary: () => Promise<void> = async () => {};
let duringReview: () => Promise<void> = async () => {};
mock.module("@/lib/review-core", () => ({ generateLocalReview: async () => {
  run++;
  await duringReview();
  return { summary: `synthetic result ${run}`, findings: [finding], model: "synthetic", usage: { inputTokens: 1, outputTokens: 1 } };
} }));
mock.module("@/lib/github", () => ({ getRepositoryTree: async () => { treeRequests++; return []; }, getPullRequestDiff: () => { throw new Error("unexpected diff fetch"); } }));
mock.module("@/lib/indexer", () => ({ indexRepository: async () => { indexRequests++; await duringIndex(); return { totalFiles: 0, indexedFiles: 0, totalChunks: 0, totalVectors: 0, contributorCount: 0, contributors: [], durationMs: 0 }; } }));
mock.module("@/lib/summarizer", () => ({ summarizeRepository: async () => { summaryRequests++; await duringSummary(); return { summary: "synthetic", purpose: "synthetic" }; } }));
mock.module("@/lib/analyzer", () => ({ analyzeRepository: async () => { analysisRequests++; return "synthetic"; } }));
mock.module("@/lib/events/bus", () => ({ eventBus: { emit: () => {} } }));
mock.module("@/lib/crypto", () => ({ decryptString: (value: string) => value, encryptString: (value: string) => value }));
mock.module("@/lib/oss-bot", () => ({ getBotToken: () => { throw new Error("unexpected bot token"); } }));
mock.module("@/lib/oss-review-post", () => ({ postOssReview: () => { throw new Error("unexpected post"); } }));
mock.module("@/lib/queue", () => ({ enqueue: () => { throw new Error("unexpected enqueue"); } }));
const { processCommunityReview } = await import("@/lib/community-review");
const { recoverCommunityReviewJobs } = await import("@/lib/community-review-recovery");
const { CommunityRepositoryChangedError } = await import("@/lib/community-pr-persist");
const newJob = () => prisma.communityReviewJob.create({ data: { repositoryId: repo.id, organizationId: source.id, repoFullName: repo.fullName,
  status: "reviewing", prNumber: 1, diff: "synthetic", githubToken: "synthetic", expiresAt: new Date(Date.now() + 60_000) } });
const jobState = (id: string) => prisma.communityReviewJob.findUniqueOrThrow({ where: { id } });
const prState = () => prisma.pullRequest.findUniqueOrThrow({ where: { repositoryId_number: { repositoryId: repo.id, number: 1 } }, include: { reviewIssues: true } });
const locker = new Client({ connectionString: process.env.DATABASE_URL });
await locker.connect();
const waitForJobLock = async () => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const [row] = await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%community_review_jobs%'`;
    if (row.count > 0) return;
    await Bun.sleep(20);
  }
  throw new Error("Expected a community job update to wait on a row lock");
};
try {
  for (const status of ["cancelled", "completed", "failed"]) {
    const terminal = await newJob();
    await prisma.communityReviewJob.update({ where: { id: terminal.id }, data: { status, summary: "prior result" } });
    await processCommunityReview(terminal.id);
    const saved = await jobState(terminal.id);
    assert.equal(saved.status, status);
    assert.equal(saved.summary, "prior result");
    assert.equal(saved.githubToken, null);
  }
  const expired = await newJob();
  await prisma.communityReviewJob.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await processCommunityReview(expired.id);
  assert.equal((await jobState(expired.id)).status, "failed");
  assert.equal((await jobState(expired.id)).githubToken, null);

  for (const processExpired of [processCommunityReview, async (_id: string) => recoverCommunityReviewJobs()]) {
    for (const moved of [false, true]) {
      const racing = await newJob();
      await prisma.communityReviewJob.update({ where: { id: racing.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await locker.query("BEGIN");
      await locker.query('SELECT id FROM community_review_jobs WHERE id = $1 FOR UPDATE', [racing.id]);
      const processing = processExpired(racing.id);
      try {
        await waitForJobLock();
        await locker.query('UPDATE community_review_jobs SET status = $1, summary = $2, "organizationId" = $3 WHERE id = $4',
          [moved ? "cancelled" : "completed", moved ? null : "prior result", moved ? target.id : source.id, racing.id]);
        await locker.query("COMMIT");
        await processing;
        const saved = await jobState(racing.id);
        assert.equal(saved.organizationId, moved ? target.id : source.id);
        assert.equal(saved.status, moved ? "cancelled" : "completed");
        assert.equal(saved.summary, moved ? null : "prior result");
        assert.equal(saved.githubToken, moved ? "synthetic" : null);
        assert.equal(await prisma.auditLog.count({ where: { action: "community_review.expired", targetId: racing.id } }), 0);
      } finally {
        await locker.query("ROLLBACK").catch(() => {});
        await processing.catch(() => {});
      }
    }
  }
  assert.equal(run, 0);
  assert.equal(treeRequests, 0);
  assert.equal(indexRequests, 0);

  {
    const racing = await newJob();
    await prisma.repository.update({ where: { id: repo.id }, data: { indexStatus: "pending" } });
    await locker.query("BEGIN");
    await locker.query('SELECT id FROM repositories WHERE id = $1 FOR UPDATE', [repo.id]);
    const processing = processCommunityReview(racing.id);
    try {
      for (let attempt = 0; ; attempt++) {
        const [row] = await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%repositories%'`;
        if (row.count) break;
        if (attempt === 100) throw new Error("Expected repository claim to wait on a row lock");
        await Bun.sleep(20);
      }
      await locker.query('UPDATE community_review_jobs SET status = $1, summary = $2 WHERE id = $3', ["cancelled", "prior result", racing.id]);
      await locker.query("COMMIT");
      await processing;
      const saved = await jobState(racing.id);
      const repository = await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } });
      assert.equal(saved.status, "cancelled");
      assert.equal(saved.summary, "prior result");
      assert.equal(saved.githubToken, null);
      assert.equal(repository.indexStatus, "pending");
      assert.equal(repository.indexAttemptId, null);
      assert.equal(indexRequests, 0);
    } finally {
      await locker.query("ROLLBACK").catch(() => {});
      await processing.catch(() => {});
    }
  }

  for (const transition of ["indexing", "summary"]) {
    const racing = await newJob();
    await prisma.repository.update({ where: { id: repo.id }, data: { indexStatus: "pending" } });
    const finish = async () => {
      await prisma.communityReviewJob.update({ where: { id: racing.id }, data: { status: "failed", summary: "expiry result" } });
    };
    duringIndex = transition === "indexing" ? finish : async () => {};
    duringSummary = transition === "summary" ? finish : async () => {};
    summaryRequests = 0;
    analysisRequests = 0;
    await processCommunityReview(racing.id);
    const saved = await jobState(racing.id);
    assert.equal(saved.status, "failed");
    assert.equal(saved.summary, "expiry result");
    assert.equal(saved.githubToken, null);
    assert.equal(run, 0);
    assert.equal(treeRequests, 0);
    assert.equal(summaryRequests, transition === "summary" ? 1 : 0);
    assert.equal(analysisRequests, 0);
  }
  duringIndex = async () => {};
  duringSummary = async () => {};
  indexRequests = 0;
  await prisma.repository.update({ where: { id: repo.id }, data: { indexStatus: "indexed" } });

  for (const change of [
    { organizationId: target.id, indexStatus: "pending" },
    { provider: "gitlab" },
    { fullName: `other/${suffix}` },
  ]) {
    const stale = await newJob();
    await prisma.repository.update({ where: { id: repo.id }, data: change });
    await assert.rejects(() => processCommunityReview(stale.id), CommunityRepositoryChangedError);
    const rejected = await jobState(stale.id);
    assert.equal(rejected.status, "failed");
    assert.equal(rejected.githubToken, null);
    assert.equal(run, 0);
    assert.equal(treeRequests, 0);
    assert.equal(indexRequests, 0);
    assert.equal(await prisma.pullRequest.count({ where: { repositoryId: repo.id } }), 0);
    await prisma.repository.update({ where: { id: repo.id }, data: {
      organizationId: source.id, provider: repo.provider, fullName: repo.fullName, indexStatus: "indexed",
    } });
  }

  const first = await newJob();
  await prisma.communityReviewJob.update({ where: { id: first.id }, data: { repoFullName: repo.fullName.toUpperCase() } });
  await processCommunityReview(first.id);
  const completed = await jobState(first.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.summary, "synthetic result 1");
  assert.equal((completed.findings as unknown[]).length, 1);
  assert.equal(completed.githubToken, null);
  const pr = await prState();
  assert.equal(pr.reviewBody, "synthetic result 1");
  assert.equal(pr.status, "completed");
  assert.equal(pr.reviewIssues.length, 1);
  assert.equal(pr.reviewIssues[0].title, finding.title);
  assert.equal(pr.reviewIssues[0].filePath, finding.filePath);

  await prisma.reviewIssue.update({ where: { id: pr.reviewIssues[0].id }, data: { feedback: "up", acknowledgedAt: new Date("2026-01-01T00:00:00Z") } });
  const second = await newJob();
  await processCommunityReview(second.id);
  assert.equal((await jobState(second.id)).status, "completed");
  const reReviewed = await prState();
  assert.equal(reReviewed.reviewBody, "synthetic result 2");
  assert.equal(reReviewed.reviewIssues.length, 1);
  assert.equal(reReviewed.reviewIssues[0].feedback, "up");
  assert.equal(reReviewed.reviewIssues[0].acknowledgedAt?.toISOString(), "2026-01-01T00:00:00.000Z");

  // The repository transfers to another organization while the model is generating.
  duringReview = async () => { await prisma.repository.update({ where: { id: repo.id }, data: { organizationId: target.id } }); };
  const third = await newJob();
  await assert.rejects(() => processCommunityReview(third.id), CommunityRepositoryChangedError);
  const failed = await jobState(third.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.summary, null);
  assert.equal(failed.findings, null);
  assert.equal(failed.githubToken, null);
  const untouched = await prState();
  assert.equal(untouched.reviewBody, "synthetic result 2");
  assert.equal(untouched.reviewIssues[0].id, reReviewed.reviewIssues[0].id);
  assert.equal(untouched.reviewIssues[0].feedback, "up");

  // Both the repository and the job row move tenants mid-review: nothing may be written to the new tenant's job.
  await prisma.repository.update({ where: { id: repo.id }, data: { organizationId: source.id } });
  const fourth = await newJob();
  duringReview = async () => {
    await prisma.repository.update({ where: { id: repo.id }, data: { organizationId: target.id } });
    await prisma.communityReviewJob.update({ where: { id: fourth.id }, data: { organizationId: target.id } });
  };
  await assert.rejects(() => processCommunityReview(fourth.id), CommunityRepositoryChangedError);
  const moved = await jobState(fourth.id);
  assert.equal(moved.status, "reviewing");
  assert.equal(moved.summary, null);
  assert.equal(moved.errorMessage, null);
  assert.equal((await prState()).reviewBody, "synthetic result 2");
  assert.equal(run, 4);

  await prisma.repository.update({ where: { id: repo.id }, data: { organizationId: source.id } });
  const cancelledDuringReview = await newJob();
  await prisma.communityReviewJob.update({ where: { id: cancelledDuringReview.id }, data: { prNumber: null } });
  duringReview = async () => {
    await prisma.communityReviewJob.update({ where: { id: cancelledDuringReview.id }, data: { status: "cancelled" } });
  };
  await assert.rejects(() => processCommunityReview(cancelledDuringReview.id), CommunityRepositoryChangedError);
  const cancelledAfterWork = await jobState(cancelledDuringReview.id);
  assert.equal(cancelledAfterWork.status, "cancelled");
  assert.equal(cancelledAfterWork.githubToken, null);
  assert.equal((await prState()).reviewBody, "synthetic result 2");
} finally {
  await locker.end();
  await prisma.communityReviewJob.deleteMany({ where: { repositoryId: repo.id } });
  await prisma.organization.deleteMany({ where: { id: { in: [source.id, target.id] } } });
  await prisma.$disconnect();
}
