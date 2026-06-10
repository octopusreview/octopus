import "server-only";
import crypto from "node:crypto";
import { prisma } from "@octopus/db";
import { chunkText, shouldIndex, MAX_FILE_SIZE } from "@/lib/index-chunking";
import { createEmbeddings } from "@/lib/embeddings";
import { generateSparseVectors } from "@/lib/sparse-vector";
import { upsertChunks, deleteRepoChunks } from "@/lib/qdrant";
import { type Ignore } from "@/lib/octopus-ignore";

/**
 * CLI-driven local indexing.
 *
 * Mirror of the github/gitlab/bitbucket indexing paths in `indexer.ts`, but
 * the file contents arrive over HTTP from the CLI instead of being cloned or
 * fetched server-side. Shares `chunkText` + `shouldIndex` + embeddings + qdrant
 * upsert with the canonical path so retrieval quality stays consistent —
 * a CLI-indexed repo gets the same chunk shape as a webhook-indexed one.
 *
 * The CLI uploads files in byte-budgeted batches so a 50 MB repo doesn't
 * have to fit in one HTTP request. Each batch is processed end-to-end
 * synchronously (chunk → embed → upsert) so the CLI can render progress
 * meaningfully — "batch 12/40 done" maps to real work. The repo row tracks
 * the running indexedFiles count so a poll-based UI also works.
 */

export type LocalFile = { path: string; content: string };

export type IndexLocalBatchResult = {
  indexedInBatch: number;
  skippedInBatch: number;
  chunksInBatch: number;
};

export async function indexLocalBatch(
  repoId: string,
  fullName: string,
  files: LocalFile[],
  ig?: Ignore,
): Promise<IndexLocalBatchResult> {
  let indexed = 0;
  let skipped = 0;
  const allChunks: { text: string; filePath: string; startLine: number; endLine: number }[] = [];

  for (const file of files) {
    if (!shouldIndex(file.path, file.content.length, ig)) {
      skipped++;
      continue;
    }
    if (file.content.length > MAX_FILE_SIZE) {
      skipped++;
      continue;
    }
    if (file.content.includes("\0")) {
      skipped++;
      continue;
    }
    const chunks = chunkText(file.content, file.path);
    for (const c of chunks) {
      allChunks.push({ text: c.text, filePath: file.path, startLine: c.startLine, endLine: c.endLine });
    }
    indexed++;
  }

  if (allChunks.length === 0) {
    return { indexedInBatch: indexed, skippedInBatch: skipped, chunksInBatch: 0 };
  }

  // Embed + upsert. Single batch through createEmbeddings — its internal
  // sub-batching handles OpenAI's 200k-token limit, so we don't double up.
  const texts = allChunks.map((c) => c.text);
  const vectors = await createEmbeddings(texts);
  const sparse = generateSparseVectors(texts);

  const indexedAt = new Date().toISOString();
  const points = allChunks.map((chunk, i) => ({
    id: crypto.randomUUID(),
    vector: vectors[i],
    sparseVector: sparse[i],
    payload: {
      repoId,
      fullName,
      filePath: chunk.filePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      text: chunk.text,
      language: chunk.filePath.split(".").pop() ?? "unknown",
      indexedAt,
    },
  }));

  await upsertChunks(points);

  return { indexedInBatch: indexed, skippedInBatch: skipped, chunksInBatch: points.length };
}

/**
 * Find-or-create the Repository row for a CLI-uploaded index. Called from the
 * first batch (batchIndex === 0). Existing rows with an `installationId` are
 * rejected — those are managed by the git-platform webhook flow and the CLI
 * shouldn't be racing the webhook's index runs against them.
 *
 * Returns the repoId on success or a typed reason on rejection so the
 * endpoint can map it to a meaningful HTTP status.
 */
export async function prepareRepoForLocalIndex(
  organizationId: string,
  provider: "github" | "gitlab" | "bitbucket",
  fullName: string,
  defaultBranch: string,
): Promise<
  | { ok: true; repoId: string; reIndex: boolean }
  | { ok: false; reason: "managed-by-platform"; repoId: string }
  | { ok: false; reason: "in-flight"; repoId: string }
> {
  const existing = await prisma.repository.findFirst({
    where: { organizationId, provider, fullName, isActive: true },
    select: { id: true, installationId: true, indexStatus: true, updatedAt: true },
  });

  if (existing) {
    if (existing.installationId != null) {
      return { ok: false, reason: "managed-by-platform", repoId: existing.id };
    }
    // Re-index guard: if a concurrent run is mid-way (indexStatus="indexing"
    // and updated within the last 5 minutes), reject this batch instead of
    // wiping the in-flight run's chunks. Without this guard, a second
    // `octp review --index` collides with the first — run B's first batch
    // deletes A's already-upserted chunks and resets counters, then A's
    // later batches keep upserting under A's repoId, ending in a partially-
    // mixed chunk set and inconsistent file/chunk counters.
    const IN_FLIGHT_WINDOW_MS = 5 * 60 * 1000;
    if (
      existing.indexStatus === "indexing" &&
      Date.now() - existing.updatedAt.getTime() < IN_FLIGHT_WINDOW_MS
    ) {
      return { ok: false, reason: "in-flight", repoId: existing.id };
    }
    // Re-index path: wipe prior chunks so stale content doesn't pollute retrieval.
    await deleteRepoChunks(existing.id);
    await prisma.repository.update({
      where: { id: existing.id },
      data: {
        indexStatus: "indexing",
        indexedFiles: 0,
        totalFiles: 0,
        totalChunks: 0,
        totalVectors: 0,
        indexDurationMs: null,
      },
    });
    return { ok: true, repoId: existing.id, reIndex: true };
  }

  // New row. `externalId` would normally be the platform's repo ID — we don't
  // have one, so fingerprint the local identity as `cli:<provider>:<fullName>`
  // to satisfy the unique constraint without colliding with platform-managed rows.
  const externalId = `cli:${provider}:${fullName}`;
  const name = fullName.split("/").pop() ?? fullName;

  const repo = await prisma.repository.create({
    data: {
      organizationId,
      provider,
      fullName,
      name,
      externalId,
      defaultBranch,
      installationId: null,
      isActive: true,
      autoReview: false, // no webhooks for CLI-local repos — auto-review doesn't apply
      indexStatus: "indexing",
    },
    select: { id: true },
  });
  return { ok: true, repoId: repo.id, reIndex: false };
}

/**
 * Apply per-batch progress to the Repository row. Called after each batch
 * succeeds. `commit` flips the status to "indexed" on the final batch.
 */
export async function recordLocalIndexProgress(
  repoId: string,
  startedAt: number,
  delta: { indexedFiles: number; totalChunks: number; totalVectors: number; totalFiles?: number },
  commit: boolean,
): Promise<void> {
  await prisma.repository.update({
    where: { id: repoId },
    data: {
      indexedFiles: { increment: delta.indexedFiles },
      totalChunks: { increment: delta.totalChunks },
      totalVectors: { increment: delta.totalVectors },
      ...(delta.totalFiles != null ? { totalFiles: delta.totalFiles } : {}),
      ...(commit
        ? {
            indexStatus: "indexed",
            indexedAt: new Date(),
            indexDurationMs: Date.now() - startedAt,
          }
        : {}),
    },
  });
}

export async function markLocalIndexFailed(repoId: string): Promise<void> {
  await prisma.repository.update({
    where: { id: repoId },
    data: { indexStatus: "failed" },
  });
}
