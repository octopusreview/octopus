import { mock } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { localQueueTestDatabaseUrl } from "../queue-test-database";

process.env.DATABASE_URL = localQueueTestDatabaseUrl(process.env.DATABASE_URL);
mock.module("server-only", () => ({}));
mock.module("@/lib/repository-index-completion", () => ({ recordRepositoryIndexCompletion: () => { throw new Error("unexpected completion"); } }));
mock.module("@/lib/embeddings", () => ({ createEmbeddings: () => { throw new Error("unexpected embeddings"); } }));
mock.module("@/lib/qdrant", () => ({ upsertChunks: () => { throw new Error("unexpected storage request"); } }));
globalThis.fetch = (() => { throw new Error("unexpected external request"); }) as typeof fetch;

const { prisma } = await import("@octopus/db");
const { prepareRepoForLocalIndex, claimLocalIndexBatch, LocalIndexConflict } = await import("@/lib/index-local");
const suffix = randomUUID();
const source = await prisma.organization.create({ data: { name: "Source", slug: `local-source-${suffix}` } });
const target = await prisma.organization.create({ data: { name: "Target", slug: `local-target-${suffix}` } });
const fullName = `synthetic/${suffix}`;
const externalId = `cli:github:${fullName}`;
try {
  const repo = await prisma.repository.create({ data: { organizationId: source.id, name: "Synthetic", fullName, externalId, provider: "github", indexStatus: "pending", indexedFiles: 17 } });
  const delegate = prisma.repository;
  const findFirst = delegate.findFirst.bind(delegate);
  let afterLookup: (() => Promise<void>) | undefined;
  delegate.findFirst = (async (...args: Parameters<typeof findFirst>) => {
    const found = await findFirst(...args);
    const hook = afterLookup; afterLookup = undefined;
    await hook?.();
    return found;
  }) as typeof delegate.findFirst;
  const prepare = () => prepareRepoForLocalIndex(source.id, "github", fullName, "main", { totalBatches: 1, totalFiles: 1 });
  for (const change of ["owner", "provider", "name", "external-id", "installation", "inactive", "index-started"]) {
    await delegate.update({ where: { id: repo.id }, data: { organizationId: source.id, provider: "github", fullName, externalId, installationId: null, isActive: true, indexStatus: "pending", indexAttemptId: null, localIndexUpload: undefined, indexedFiles: 17 } });
    afterLookup = async () => {
      await delegate.update({ where: { id: repo.id }, data:
        change === "owner" ? { organizationId: target.id } :
        change === "provider" ? { provider: "gitlab" } :
        change === "name" ? { fullName: `${fullName}-renamed` } :
        change === "external-id" ? { externalId: "platform-managed" } :
        change === "installation" ? { installationId: 123 } :
        change === "inactive" ? { isActive: false } : { indexStatus: "indexing", indexAttemptId: "another-attempt" },
      });
    };
    const result = await prepare();
    assert.deepEqual(result, change === "index-started" ? { ok: false, reason: "in-flight", repoId: repo.id } : { ok: false, reason: "repository-changed" }, change);
    const current = await delegate.findUniqueOrThrow({ where: { id: repo.id } });
    assert.equal(current.indexedFiles, 17, `${change} must not reset another repository's index`);
    assert.equal(current.localIndexUpload, null, `${change} must not install an upload`);
    if (change === "index-started") assert.equal(current.indexAttemptId, "another-attempt");
  }
  await delegate.update({ where: { id: repo.id }, data: { indexStatus: "pending", indexAttemptId: null } });
  const locker = new Client({ connectionString: process.env.DATABASE_URL });
  await locker.connect();
  try {
    afterLookup = async () => {
      await locker.query("BEGIN");
      await locker.query('UPDATE repositories SET "organizationId" = $1 WHERE id = $2', [target.id, repo.id]);
    };
    const pending = prepare();
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const rows = await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
      if (rows[0].n > 0) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(waiting, "the local claim must wait for the competing transfer");
    await locker.query("COMMIT");
    assert.deepEqual(await pending, { ok: false, reason: "repository-changed" });
    const current = await delegate.findUniqueOrThrow({ where: { id: repo.id } });
    assert.equal(current.organizationId, target.id);
    assert.equal(current.indexedFiles, 17);
    assert.equal(current.localIndexUpload, null);
  } finally { await locker.query("ROLLBACK").catch(() => {}); await locker.end(); }
  await delegate.update({ where: { id: repo.id }, data: { organizationId: source.id } });
  const result = await prepare();
  assert.equal(result.ok, true, "an unchanged local repository remains indexable");
  assert.equal((await delegate.findUniqueOrThrow({ where: { id: repo.id } })).indexStatus, "indexing");
  assert.ok(result.ok);
  const files = [{ path: "file.ts", content: "synthetic" }];
  for (const change of ["owner", "provider", "name", "external-id", "installation", "inactive"]) {
    for (const uploadId of [result.uploadId, undefined]) {
      await delegate.update({ where: { id: repo.id }, data: { organizationId: source.id, provider: "github", fullName, externalId, installationId: null, isActive: true, indexAttemptId: null } });
      await delegate.update({ where: { id: repo.id }, data:
        change === "owner" ? { organizationId: target.id } :
        change === "provider" ? { provider: "gitlab" } :
        change === "name" ? { fullName: `${fullName}-renamed` } :
        change === "external-id" ? { externalId: "cli:changed" } :
        change === "installation" ? { installationId: 123 } : { isActive: false },
      });
      await assert.rejects(() => claimLocalIndexBatch(repo.id, change === "owner" ? target.id : source.id, 0, 1, files, uploadId), LocalIndexConflict, `${change} before lookup`);
      assert.equal((await delegate.findUniqueOrThrow({ where: { id: repo.id } })).indexAttemptId, null);
    }
  }
  for (const change of ["wrong-tenant", "owner", "provider", "name", "external-id", "installation", "inactive"]) {
    await delegate.update({ where: { id: repo.id }, data: { organizationId: source.id, provider: "github", fullName, externalId, installationId: null, isActive: true, indexAttemptId: null } });
    if (change !== "wrong-tenant") afterLookup = async () => {
      await delegate.update({ where: { id: repo.id }, data:
        change === "owner" ? { organizationId: target.id } :
        change === "provider" ? { provider: "gitlab" } :
        change === "name" ? { fullName: `${fullName}-renamed` } :
        change === "external-id" ? { externalId: "platform-managed" } :
        change === "installation" ? { installationId: 123 } : { isActive: false },
      });
    };
    await assert.rejects(() => claimLocalIndexBatch(repo.id, change === "wrong-tenant" ? target.id : source.id, 0, 1, files, result.uploadId), LocalIndexConflict, change);
    assert.equal((await delegate.findUniqueOrThrow({ where: { id: repo.id } })).indexAttemptId, null, `${change} must not claim a batch`);
  }
  await delegate.update({ where: { id: repo.id }, data: { organizationId: source.id, provider: "github", fullName, externalId, installationId: null, isActive: true } });
  assert.equal((await claimLocalIndexBatch(repo.id, source.id, 0, 1, files, result.uploadId)).upload.id, result.uploadId);
} finally {
  await prisma.organization.deleteMany({ where: { id: { in: [source.id, target.id] } } });
  await prisma.$disconnect();
}
