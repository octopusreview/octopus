import { mock } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const db = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["postgres:", "postgresql:"].includes(db.protocol));
assert.ok(["localhost", "127.0.0.1"].includes(db.hostname));
assert.match(db.pathname.slice(1), /(^|[-_])test($|[-_])/);
assert.equal(db.search + db.hash, "");
mock.module("server-only", () => ({}));
mock.module("@/lib/queue", () => ({ enqueue: async () => null }));
mock.module("@/lib/elasticsearch", () => ({ deleteSyncLogs: async () => {}, writeSyncLog: () => {} }));
mock.module("@/lib/repository-index-notifications", () => ({ notifyRepositoryIndex: async () => {} }));
mock.module("../../background-failure", () => ({ reportBackgroundFailure: () => {} }));
let mode: "generic" | "deferred" = "generic";
let calls = 0;
const { GitHubIndexDeferredError } = await import("../../github-index-fetch");
mock.module("@/lib/indexer", () => ({ indexRepository: async () => {
  calls++;
  if (mode === "deferred") throw new GitHubIndexDeferredError(403);
  throw new Error("synthetic transient failure");
} }));
const { prisma } = await import("@octopus/db");
const { processRepositoryIndex } = await import("../../repository-index-job");
const repo = "synthetic-worker-repo", org = "synthetic-worker-org", jobId = randomUUID();
const job = { repositoryId: repo, organizationId: org, expectedAttemptId: "old-attempt" };
try {
  await prisma.$executeRaw`INSERT INTO "organizations" ("id", "githubInstallationId") VALUES (${org}, 123)`;
  await prisma.$executeRaw`INSERT INTO "repositories" ("id", "organizationId", "fullName", "defaultBranch", "provider", "installationId", "indexStatus", "indexAttemptId")
    VALUES (${repo}, ${org}, 'synthetic/repo', 'main', 'github', 123, 'failed', 'old-attempt')`;
  await assert.rejects(processRepositoryIndex(job, { retryCount: 0, retryLimit: 2 }, jobId), /synthetic transient failure/);
  const first = await prisma.repository.findUniqueOrThrow({ where: { id: repo }, select: { indexStatus: true, indexAttemptId: true } });
  assert.equal(first.indexStatus, "failed");
  assert.notEqual(first.indexAttemptId, "old-attempt");
  await prisma.$executeRaw`UPDATE "repositories" SET "indexStatus" = 'indexing' WHERE "id" = ${repo}`;
  // Retry 1 crashed before claiming; retry 2 must still reclaim retry 0's attempt.
  await assert.rejects(processRepositoryIndex(job, { retryCount: 2, retryLimit: 2 }, jobId), /synthetic transient failure/);
  const second = await prisma.repository.findUniqueOrThrow({ where: { id: repo }, select: { indexStatus: true, indexAttemptId: true } });
  assert.equal(second.indexStatus, "failed");
  assert.notEqual(second.indexAttemptId, first.indexAttemptId, "each retry uses a new fenced attempt");
  assert.equal(calls, 2);
  await assert.rejects(processRepositoryIndex(job, { retryCount: 101, retryLimit: 101 }, jobId), /valid job identity/);
  await prisma.$executeRaw`UPDATE "repositories" SET "indexAttemptId" = 'manual-replacement' WHERE "id" = ${repo}`;
  await processRepositoryIndex(job, { retryCount: 2, retryLimit: 2 }, jobId);
  assert.equal(calls, 2, "a newer attempt prevents an old queued retry");

  await prisma.$executeRaw`UPDATE "repositories" SET "indexStatus" = 'pending', "indexAttemptId" = NULL WHERE "id" = ${repo}`;
  mode = "deferred";
  await processRepositoryIndex({ repositoryId: repo, organizationId: org }, { retryCount: 0, retryLimit: 2 }, randomUUID());
  const row = await prisma.$queryRaw<Array<{ indexAttemptId: string }>>`SELECT "indexAttemptId" FROM "github_deferred_indexes" WHERE "repositoryId" = ${repo}`;
  const deferredRepo = await prisma.repository.findUniqueOrThrow({ where: { id: repo }, select: { indexStatus: true, indexAttemptId: true } });
  assert.equal(deferredRepo.indexStatus, "failed");
  assert.equal(row[0]?.indexAttemptId, deferredRepo.indexAttemptId, "the deferred intent owns the released claim");
} finally {
  await prisma.$executeRaw`DELETE FROM "repositories" WHERE "id" = ${repo}`;
  await prisma.$executeRaw`DELETE FROM "organizations" WHERE "id" = ${org}`;
  await prisma.$disconnect();
}
