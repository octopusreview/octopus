import { mock } from "bun:test";
import assert from "node:assert/strict";

const row: { id: string; organizationId: string; provider: string; fullName: string; isActive: boolean; externalId: string; installationId: null; indexStatus: string; indexAttemptId: string | null; syncLogAttemptId: string | null; localIndexUpload: unknown; updatedAt: Date } = {
  id: "repo", organizationId: "org", provider: "github", fullName: "fixture/repo", isActive: true, externalId: "cli:github:fixture/repo", installationId: null,
  indexStatus: "indexed", indexAttemptId: null, syncLogAttemptId: "old-upload",
  localIndexUpload: { id: "old-upload" }, updatedAt: new Date(),
};
const repository = {
  findFirst: async () => row,
  findUniqueOrThrow: async () => ({ ...row }),
  updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    if (where.indexAttemptId !== undefined && where.indexAttemptId !== row.indexAttemptId) return { count: 0 };
    if (typeof where.indexStatus === "string" && where.indexStatus !== row.indexStatus) return { count: 0 };
    Object.assign(row, data);
    return { count: 1 };
  },
};
const prisma = { repository, $transaction: async (work: (tx: unknown) => unknown) => work({ repository, $queryRaw: async () => [{ syncLogAttemptId: row.syncLogAttemptId }] }) };
mock.module("server-only", () => ({}));
mock.module("@octopus/db", () => ({ prisma }));
mock.module("@/lib/embeddings", () => ({ createEmbeddings: async () => [] }));
mock.module("@/lib/qdrant", () => ({ upsertChunks: async () => {} }));
const newWriter = !!process.env.LOCAL_INDEX_WRITER_FILE;
const { prepareRepoForLocalIndex, claimLocalIndexBatch, recordLocalIndexProgress, markLocalIndexFailed } = await import(process.env.LOCAL_INDEX_WRITER_FILE || "@/lib/index-local");
const { getSyncLogAttempt } = await import("@/lib/repository-index-completion");
const tenantScoped = claimLocalIndexBatch.length >= 6;
const claimBatch = claimLocalIndexBatch as unknown as (...args: unknown[]) => ReturnType<typeof claimLocalIndexBatch>;
const failBatch = markLocalIndexFailed as unknown as (...args: unknown[]) => ReturnType<typeof markLocalIndexFailed>;
const prepared = await prepareRepoForLocalIndex("org", "github", "fixture/repo", "main", { totalBatches: 2, totalFiles: 2 });
assert.ok(prepared.ok);
const selected = () => getSyncLogAttempt(row as Parameters<typeof getSyncLogAttempt>[0]);
const expected = newWriter ? prepared.uploadId : undefined;
assert.equal(selected(), expected);
const first = await claimBatch(...(tenantScoped ? ["repo", "org", 0, 2, [{ path: "a.ts", content: "a" }], prepared.uploadId] : ["repo", 0, 2, [{ path: "a.ts", content: "a" }], prepared.uploadId]));
assert.equal(selected(), expected);
const progress = { indexedFiles: 0, totalChunks: 0, totalVectors: 0 };
await recordLocalIndexProgress("repo", null, progress, false, first);
assert.equal(selected(), expected);
const second = await claimBatch(...(tenantScoped ? ["repo", "org", 1, 2, [{ path: "b.ts", content: "b" }], prepared.uploadId] : ["repo", 1, 2, [{ path: "b.ts", content: "b" }], prepared.uploadId]));
assert.equal(selected(), expected);
row.indexStatus = "pending";
row.indexAttemptId = null;
await assert.rejects(() => recordLocalIndexProgress("repo", null, progress, true, second));
await failBatch("repo", tenantScoped ? second : second.attemptId);
assert.equal(row.indexStatus, "pending");
assert.equal(selected(), expected);
row.indexStatus = "indexing";
row.indexAttemptId = "replacement";
await assert.rejects(() => recordLocalIndexProgress("repo", null, progress, true, second));
assert.equal(selected(), undefined);
row.indexAttemptId = second.attemptId;
await recordLocalIndexProgress("repo", null, progress, true, second);
assert.equal(row.indexStatus, "indexed");
assert.equal(selected(), expected);
