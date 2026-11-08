import { mock } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
let duringReview: () => Promise<void> = async () => {};
mock.module("@/lib/review-core", () => ({ generateLocalReview: async () => {
  run++;
  await duringReview();
  return { summary: `synthetic result ${run}`, findings: [finding], model: "synthetic", usage: { inputTokens: 1, outputTokens: 1 } };
} }));
mock.module("@/lib/github", () => ({ getRepositoryTree: async () => { treeRequests++; return []; }, getPullRequestDiff: () => { throw new Error("unexpected diff fetch"); } }));
mock.module("@/lib/repository-index-completion", () => ({ runRepositoryIndex: () => { indexRequests++; throw new Error("unexpected index"); } }));
mock.module("@/lib/indexer", () => ({ indexRepository: () => { throw new Error("unexpected index"); } }));
mock.module("@/lib/summarizer", () => ({ summarizeRepository: () => { throw new Error("unexpected summary"); } }));
mock.module("@/lib/analyzer", () => ({ analyzeRepository: () => { throw new Error("unexpected analysis"); } }));
mock.module("@/lib/events/bus", () => ({ eventBus: { emit: () => {} } }));
mock.module("@/lib/crypto", () => ({ decryptString: (value: string) => value, encryptString: (value: string) => value }));
mock.module("@/lib/oss-bot", () => ({ getBotToken: () => { throw new Error("unexpected bot token"); } }));
mock.module("@/lib/oss-review-post", () => ({ postOssReview: () => { throw new Error("unexpected post"); } }));
const { processCommunityReview } = await import("@/lib/community-review");
const { CommunityRepositoryChangedError } = await import("@/lib/community-pr-persist");
const newJob = () => prisma.communityReviewJob.create({ data: { repositoryId: repo.id, organizationId: source.id, repoFullName: repo.fullName,
  status: "reviewing", prNumber: 1, diff: "synthetic", githubToken: "synthetic", expiresAt: new Date(Date.now() + 60_000) } });
const jobState = (id: string) => prisma.communityReviewJob.findUniqueOrThrow({ where: { id } });
const prState = () => prisma.pullRequest.findUniqueOrThrow({ where: { repositoryId_number: { repositoryId: repo.id, number: 1 } }, include: { reviewIssues: true } });
try {
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
} finally {
  await prisma.communityReviewJob.deleteMany({ where: { repositoryId: repo.id } });
  await prisma.organization.deleteMany({ where: { id: { in: [source.id, target.id] } } });
  await prisma.$disconnect();
}
