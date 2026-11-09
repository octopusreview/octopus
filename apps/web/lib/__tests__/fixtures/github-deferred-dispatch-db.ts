import { mock } from "bun:test";
import assert from "node:assert/strict";
import { PgBoss } from "pg-boss";

const db = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["postgres:", "postgresql:"].includes(db.protocol));
assert.ok(["localhost", "127.0.0.1"].includes(db.hostname));
assert.match(db.pathname.slice(1), /(^|[-_])test($|[-_])/);
assert.equal(db.search + db.hash, "");
mock.module("server-only", () => ({}));
const { prisma } = await import("@octopus/db");
const { dispatchDeferredIndexes, rememberDeferredIndex } = await import("../../github-deferred-index");
const { recordIndexRateLimit } = await import("../../github-index-rate-state");
const repo = "synthetic-dispatch-repo", org = "synthetic-dispatch-org", scope = "github-index-installation:123";
const boss = new PgBoss(process.env.DATABASE_URL!);
await boss.start();
await boss.createQueue("index-repository", { retryLimit: 2 });
const remember = () => prisma.$transaction(tx => rememberDeferredIndex(tx, { repositoryId: repo, organizationId: org, installationId: 123, indexAttemptId: "old-attempt" }));
try {
  await prisma.$executeRaw`INSERT INTO "organizations" ("id", "githubInstallationId") VALUES (${org}, 123)`;
  await prisma.$executeRaw`INSERT INTO "repositories" ("id", "organizationId", "provider", "installationId", "indexStatus", "indexAttemptId")
    VALUES (${repo}, ${org}, 'github', 123, 'failed', 'old-attempt')`;
  await remember();
  const row = await prisma.$queryRaw<Array<{ jobId: string }>>`SELECT "jobId" FROM "github_deferred_indexes" WHERE "repositoryId" = ${repo}`;
  const jobId = row[0].jobId;
  await recordIndexRateLimit(scope, 3_600_000);
  assert.equal(await dispatchDeferredIndexes(boss), 0);
  assert.equal(await boss.getJobById("index-repository", jobId), null, "no job starts during the cooldown");
  await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${scope}`;
  const failingBoss = { send: async (...args: Parameters<typeof boss.send>) => { await boss.send(...args); throw new Error("synthetic failure"); } } as unknown as PgBoss;
  await assert.rejects(dispatchDeferredIndexes(failingBoss), /synthetic failure/);
  assert.equal(await boss.getJobById("index-repository", jobId), null, "queue insertion rolls back with the outbox row");
  assert.equal((await prisma.$queryRaw<unknown[]>`SELECT 1 FROM "github_deferred_indexes" WHERE "repositoryId" = ${repo}`).length, 1);
  const counts = await Promise.all([dispatchDeferredIndexes(boss), dispatchDeferredIndexes(boss)]);
  assert.equal(counts[0] + counts[1], 1, "concurrent sweepers enqueue one job");
  const queued = await boss.getJobById<{ repositoryId: string; organizationId: string; expectedAttemptId: string }>("index-repository", jobId);
  assert.deepEqual(queued?.data, { repositoryId: repo, organizationId: org, expectedAttemptId: "old-attempt" });
  assert.equal((await prisma.$queryRaw<unknown[]>`SELECT 1 FROM "github_deferred_indexes" WHERE "repositoryId" = ${repo}`).length, 0);

  await remember();
  const stale = await prisma.$queryRaw<Array<{ jobId: string }>>`SELECT "jobId" FROM "github_deferred_indexes" WHERE "repositoryId" = ${repo}`;
  await prisma.$executeRaw`UPDATE "repositories" SET "indexAttemptId" = 'replacement' WHERE "id" = ${repo}`;
  assert.equal(await dispatchDeferredIndexes(boss), 0);
  assert.equal(await boss.getJobById("index-repository", stale[0].jobId), null, "superseded work cannot be enqueued");
  await prisma.$executeRaw`UPDATE "repositories" SET "indexAttemptId" = 'old-attempt' WHERE "id" = ${repo}`;
  await remember();
  const disconnected = await prisma.$queryRaw<Array<{ jobId: string }>>`SELECT "jobId" FROM "github_deferred_indexes" WHERE "repositoryId" = ${repo}`;
  await prisma.$executeRaw`UPDATE "organizations" SET "githubInstallationId" = 456 WHERE "id" = ${org}`;
  assert.equal(await dispatchDeferredIndexes(boss), 0);
  assert.equal(await boss.getJobById("index-repository", disconnected[0].jobId), null, "a replaced installation cannot inherit deferred work");
  await prisma.$executeRaw`UPDATE "organizations" SET "githubInstallationId" = 123 WHERE "id" = ${org}`;
  await remember();
  const cancelled = await prisma.$queryRaw<Array<{ jobId: string }>>`SELECT "jobId" FROM "github_deferred_indexes" WHERE "repositoryId" = ${repo}`;
  await prisma.$executeRaw`UPDATE "repositories" SET "indexStatus" = 'pending' WHERE "id" = ${repo}`;
  assert.equal(await dispatchDeferredIndexes(boss), 0);
  assert.equal(await boss.getJobById("index-repository", cancelled[0].jobId), null, "a cancelled attempt cannot restart");
} finally {
  await boss.stop();
  await prisma.$executeRaw`DELETE FROM "repositories" WHERE "id" = ${repo}`;
  await prisma.$executeRaw`DELETE FROM "organizations" WHERE "id" = ${org}`;
  await prisma.$executeRaw`DELETE FROM "github_index_rate_windows" WHERE "scope" = ${scope}`;
  await prisma.$disconnect();
}
