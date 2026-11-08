import { mock } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { localQueueTestDatabaseUrl } from "../queue-test-database";

process.env.DATABASE_URL = localQueueTestDatabaseUrl(process.env.DATABASE_URL);
mock.module("server-only", () => ({}));
globalThis.fetch = (() => { throw new Error("unexpected external request"); }) as typeof fetch;
const { prisma } = await import("@octopus/db");
const { persistCommunityReviewToPR, CommunityRepositoryChangedError } = await import("@/lib/community-pr-persist");
const { completeCommunityReviewJob } = await import("@/lib/community-review-completion");
const suffix = randomUUID();
const source = await prisma.organization.create({ data: { name: "Source", slug: `community-source-${suffix}` } });
const target = await prisma.organization.create({ data: { name: "Target", slug: `community-target-${suffix}` } });
const repo = await prisma.repository.create({ data: { organizationId: source.id, name: "Synthetic", fullName: `synthetic/${suffix}`, externalId: suffix, provider: "github" } });
const locker = new Client({ connectionString: process.env.DATABASE_URL });
await locker.connect();
const input = { repositoryId: repo.id, organizationId: source.id, externalId: repo.externalId, fullName: repo.fullName, prNumber: 1, summary: "synthetic result", findings: [] };
const current = () => prisma.pullRequest.findUniqueOrThrow({ where: { repositoryId_number: { repositoryId: repo.id, number: 1 } } });
const waitFor = async (condition: () => Promise<boolean>) => {
  for (let i = 0; i < 150; i++) { if (await condition()) return true; await new Promise(resolve => setTimeout(resolve, 20)); }
  return false;
};
try {
  await persistCommunityReviewToPR(input);
  assert.equal((await current()).reviewBody, input.summary);
  await persistCommunityReviewToPR({ ...input, fullName: repo.fullName.toUpperCase() });
  const finding = { severity: "🟠", title: "Synthetic finding", filePath: "file.ts", startLine: 1, endLine: 1,
    category: "synthetic", description: "Synthetic description", suggestion: "Synthetic suggestion", confidence: 1 };
  await persistCommunityReviewToPR({ ...input, findings: [finding] });
  const prior = await prisma.reviewIssue.findFirstOrThrow({ where: { pullRequestId: (await current()).id } });
  await prisma.reviewIssue.update({ where: { id: prior.id }, data: { feedback: "up", acknowledgedAt: new Date("2026-01-01T00:00:00Z") } });
  await persistCommunityReviewToPR({ ...input, findings: [finding] });
  const triaged = await prisma.reviewIssue.findFirstOrThrow({ where: { pullRequestId: (await current()).id } });
  assert.equal(triaged.feedback, "up");
  assert.equal(triaged.acknowledgedAt?.toISOString(), "2026-01-01T00:00:00.000Z");
  await locker.query('CREATE FUNCTION community_issue_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'synthetic insert failure\'; END $$');
  await locker.query('CREATE TRIGGER community_issue_test_failure BEFORE INSERT ON review_issues FOR EACH ROW EXECUTE FUNCTION community_issue_test_failure()');
  await assert.rejects(() => persistCommunityReviewToPR({ ...input, summary: "must roll back", findings: [finding] }));
  assert.equal((await current()).reviewBody, input.summary, "a finding write failure must roll back the review body");
  assert.equal((await prisma.reviewIssue.findFirstOrThrow({ where: { pullRequestId: (await current()).id } })).id, triaged.id);
  await locker.query('DROP TRIGGER community_issue_test_failure ON review_issues');
  await locker.query('DROP FUNCTION community_issue_test_failure()');
  for (const change of ["organization", "provider", "name", "external-id"]) {
    await prisma.repository.update({ where: { id: repo.id }, data: { organizationId: source.id, provider: "github", fullName: repo.fullName, externalId: repo.externalId } });
    await prisma.repository.update({ where: { id: repo.id }, data: change === "organization" ? { organizationId: target.id } : change === "provider" ? { provider: "gitlab" } : change === "name" ? { fullName: "synthetic/renamed" } : { externalId: randomUUID() } });
    await assert.rejects(() => persistCommunityReviewToPR({ ...input, summary: "stale" }), CommunityRepositoryChangedError, change);
    assert.equal((await current()).reviewBody, input.summary);
  }
  await prisma.repository.update({ where: { id: repo.id }, data: { organizationId: source.id, provider: "github", fullName: repo.fullName, externalId: repo.externalId } });
  await locker.query("BEGIN");
  await locker.query('UPDATE repositories SET "organizationId" = $1 WHERE id = $2', [target.id, repo.id]);
  const stale = persistCommunityReviewToPR({ ...input, summary: "stale" });
  assert.ok(await waitFor(async () => (await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)[0].n > 0));
  await locker.query("COMMIT");
  await assert.rejects(() => stale, CommunityRepositoryChangedError);
  assert.equal((await current()).reviewBody, input.summary);

  await prisma.repository.update({ where: { id: repo.id }, data: { organizationId: source.id } });
  await locker.query('CREATE FUNCTION community_persist_test_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(2); RETURN NEW; END $$');
  await locker.query('CREATE TRIGGER community_persist_test_delay BEFORE UPDATE ON pull_requests FOR EACH ROW EXECUTE FUNCTION community_persist_test_delay()');
  const saving = persistCommunityReviewToPR({ ...input, summary: "saved before transfer" });
  assert.ok(await waitFor(async () => (await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'PgSleep'`)[0].n > 0));
  const moving = locker.query('UPDATE repositories SET "organizationId" = $1 WHERE id = $2', [target.id, repo.id]);
  assert.ok(await waitFor(async () => (await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)[0].n > 0));
  await saving;
  await moving;
  assert.equal((await current()).reviewBody, "saved before transfer");
  assert.equal((await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } })).organizationId, target.id);

  await prisma.repository.update({ where: { id: repo.id }, data: { organizationId: source.id } });
  const job = await prisma.communityReviewJob.create({ data: { repositoryId: repo.id, organizationId: source.id,
    repoFullName: repo.fullName, status: "reviewing", diff: "synthetic", expiresAt: new Date(Date.now() + 60_000) } });
  const identity = { repositoryId: repo.id, organizationId: source.id, externalId: repo.externalId, fullName: repo.fullName };
  await prisma.communityReviewJob.update({ where: { id: job.id }, data: { organizationId: target.id } });
  await assert.rejects(() => completeCommunityReviewJob(job.id, identity, { status: "completed", summary: "stale result" }), CommunityRepositoryChangedError);
  assert.equal((await prisma.communityReviewJob.findUniqueOrThrow({ where: { id: job.id } })).status, "reviewing");
  await prisma.communityReviewJob.update({ where: { id: job.id }, data: { organizationId: source.id } });
  for (const status of ["completed", "failed", "cancelled"]) {
    await prisma.communityReviewJob.update({ where: { id: job.id }, data: { status } });
    await assert.rejects(() => completeCommunityReviewJob(job.id, identity, { status: "completed", summary: "stale result" }), CommunityRepositoryChangedError);
    const terminal = await prisma.communityReviewJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(terminal.status, status);
    assert.equal(terminal.summary, null);
  }
  await prisma.communityReviewJob.update({ where: { id: job.id }, data: { status: "reviewing" } });
  await locker.query("BEGIN");
  await locker.query('UPDATE repositories SET "organizationId" = $1 WHERE id = $2', [target.id, repo.id]);
  const staleJob = completeCommunityReviewJob(job.id, identity, { status: "completed", summary: "stale result" });
  assert.ok(await waitFor(async () => (await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)[0].n > 0));
  await locker.query("COMMIT");
  await assert.rejects(() => staleJob, CommunityRepositoryChangedError);
  const unchangedJob = await prisma.communityReviewJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(unchangedJob.status, "reviewing");
  assert.equal(unchangedJob.summary, null);

  await prisma.repository.update({ where: { id: repo.id }, data: { organizationId: source.id } });
  await locker.query('CREATE FUNCTION community_job_test_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(2); RETURN NEW; END $$');
  await locker.query('CREATE TRIGGER community_job_test_delay BEFORE UPDATE ON community_review_jobs FOR EACH ROW EXECUTE FUNCTION community_job_test_delay()');
  const savingJob = completeCommunityReviewJob(job.id, identity, { status: "completed", summary: "saved before transfer" });
  assert.ok(await waitFor(async () => (await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'PgSleep'`)[0].n > 0));
  const movingJobRepo = locker.query('UPDATE repositories SET "organizationId" = $1 WHERE id = $2', [target.id, repo.id]);
  assert.ok(await waitFor(async () => (await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)[0].n > 0));
  await savingJob;
  await movingJobRepo;
  assert.equal((await prisma.communityReviewJob.findUniqueOrThrow({ where: { id: job.id } })).summary, "saved before transfer");
} finally {
  await locker.query("ROLLBACK").catch(() => {});
  await locker.query('DROP TRIGGER IF EXISTS community_persist_test_delay ON pull_requests').catch(() => {});
  await locker.query('DROP FUNCTION IF EXISTS community_persist_test_delay()').catch(() => {});
  await locker.query('DROP TRIGGER IF EXISTS community_issue_test_failure ON review_issues').catch(() => {});
  await locker.query('DROP FUNCTION IF EXISTS community_issue_test_failure()').catch(() => {});
  await locker.query('DROP TRIGGER IF EXISTS community_job_test_delay ON community_review_jobs').catch(() => {});
  await locker.query('DROP FUNCTION IF EXISTS community_job_test_delay()').catch(() => {});
  await locker.end();
  await prisma.communityReviewJob.deleteMany({ where: { repositoryId: repo.id } });
  await prisma.organization.deleteMany({ where: { id: { in: [source.id, target.id] } } });
  await prisma.$disconnect();
}
