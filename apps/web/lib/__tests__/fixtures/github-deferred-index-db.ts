import { mock } from "bun:test";
import assert from "node:assert/strict";

const db = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["postgres:", "postgresql:"].includes(db.protocol));
assert.ok(["localhost", "127.0.0.1"].includes(db.hostname));
assert.match(db.pathname.slice(1), /(^|[-_])test($|[-_])/);
assert.equal(db.search + db.hash, "");
mock.module("server-only", () => ({}));
const { prisma } = await import("@octopus/db");
const { runRepositoryIndex, SupersededIndexError } = await import("../../repository-index-completion");
const { rememberDeferredIndex } = await import("../../github-deferred-index");
const { GitHubIndexDeferredError } = await import("../../github-index-fetch");
const repo = "synthetic-deferred-repo";
const fail = async () => { throw new GitHubIndexDeferredError(403); };
const remember = (tx: Parameters<typeof rememberDeferredIndex>[0], attempt: string) => rememberDeferredIndex(tx, {
  repositoryId: repo, organizationId: "synthetic-org", installationId: 123, indexAttemptId: attempt,
});
const reset = async (attempt: string) => {
  await prisma.$executeRaw`DELETE FROM "github_deferred_indexes"`;
  await prisma.$executeRaw`UPDATE "repositories" SET "indexStatus" = 'indexing', "indexAttemptId" = ${attempt} WHERE "id" = ${repo}`;
};
try {
  await prisma.$executeRaw`INSERT INTO "repositories" ("id", "indexStatus", "indexAttemptId") VALUES (${repo}, 'indexing', 'first')`;
  await assert.rejects(runRepositoryIndex(repo, "first", fail, undefined, tx => remember(tx, "first")), GitHubIndexDeferredError);
  const failed = await prisma.repository.findUniqueOrThrow({ where: { id: repo }, select: { indexStatus: true, indexAttemptId: true } });
  assert.deepEqual(failed, { indexStatus: "failed", indexAttemptId: "first" });
  const saved = await prisma.$queryRaw<Array<{ indexAttemptId: string }>>`SELECT "indexAttemptId" FROM "github_deferred_indexes" WHERE "repositoryId" = ${repo}`;
  assert.equal(saved[0]?.indexAttemptId, "first");

  await reset("rollback");
  await assert.rejects(runRepositoryIndex(repo, "rollback", fail, undefined, async tx => {
    await remember(tx, "rollback");
    throw new Error("synthetic transaction failure");
  }), /synthetic transaction failure/);
  const rolledBack = await prisma.repository.findUniqueOrThrow({ where: { id: repo }, select: { indexStatus: true } });
  assert.equal(rolledBack.indexStatus, "indexing", "failure to persist retry must not release the claim");
  assert.equal((await prisma.$queryRaw<unknown[]>`SELECT 1 FROM "github_deferred_indexes"`).length, 0);

  await reset("stale");
  await assert.rejects(runRepositoryIndex(repo, "stale", async () => {
    await prisma.$executeRaw`UPDATE "repositories" SET "indexAttemptId" = 'new-owner' WHERE "id" = ${repo}`;
    return fail();
  }, undefined, tx => remember(tx, "stale")), SupersededIndexError);
  assert.equal((await prisma.$queryRaw<unknown[]>`SELECT 1 FROM "github_deferred_indexes"`).length, 0, "superseded attempts cannot schedule work");

  await reset("cancelled");
  const controller = new AbortController();
  await assert.rejects(runRepositoryIndex(repo, "cancelled", async () => { controller.abort(); return fail(); }, controller.signal, tx => remember(tx, "cancelled")));
  const cancelled = await prisma.repository.findUniqueOrThrow({ where: { id: repo }, select: { indexStatus: true } });
  assert.equal(cancelled.indexStatus, "pending");
  assert.equal((await prisma.$queryRaw<unknown[]>`SELECT 1 FROM "github_deferred_indexes"`).length, 0, "cancelled attempts cannot schedule work");
} finally {
  await prisma.$executeRaw`DELETE FROM "repositories" WHERE "id" = ${repo}`;
  await prisma.$disconnect();
}
