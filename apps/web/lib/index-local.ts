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

/**
 * Process one batch of CLI-uploaded files into chunks + embeddings + Qdrant
 * points. `organizationId` is required so:
 *   1. Embeddings resolve through the same `getEmbedModel(orgId, repoId)`
 *      chain the review query path uses (review-core.ts:216). Without this
 *      the index would embed with the env-default model while the query
 *      embeds with the org/repo override — different embedding spaces,
 *      sometimes different dims → Qdrant 400 or silently garbage retrieval.
 *   2. `createEmbeddings` logs an `ai_usage` row (provider + tokens) so
 *      CLI-driven indexing spend is visible to the spend-limit check and
 *      billing/reporting, matching the review path.
 */
export async function indexLocalBatch(
  repoId: string,
  fullName: string,
  organizationId: string,
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
  // Tracking ensures: (a) the same getEmbedModel chain as the query path,
  // (b) an ai_usage row so spend accounting is honest.
  const texts = allChunks.map((c) => c.text);
  const vectors = await createEmbeddings(texts, {
    organizationId,
    operation: "index-local",
    repositoryId: repoId,
  });

  // Defense-in-depth: createEmbeddings returns empty vectors when the org
  // is over its spend limit. The route gate ahead of us already 402s in
  // that case, but if it ever fails open we'd upsert zero-length vectors
  // which Qdrant accepts but produces garbage retrieval — fail loud
  // instead so we never poison the index. Three checks because the
  // failure modes are distinct:
  //   1. vectors.length !== texts.length — createEmbeddings dropped some
  //      inputs (whitespace filter) but the caller expects 1:1 here since
  //      texts were already validated upstream
  //   2. vectors.length === 0 — outer call returned nothing
  //   3. any zero-length vector — over-spend-limit return shape
  // The original `vectors.every(...)` returned true on `[]` (vacuously)
  // and missed (1) + (2), so a fail-open in either of those would still
  // produce a garbage index.
  if (
    vectors.length !== texts.length ||
    vectors.length === 0 ||
    vectors.some((v) => v.length === 0)
  ) {
    throw new Error(
      `Embedding step returned ${vectors.length} vectors for ${texts.length} inputs (or empty vectors — likely org over spend limit). Aborting upsert to avoid poisoning the index.`,
    );
  }

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
> {
  const existing = await prisma.repository.findFirst({
    where: { organizationId, provider, fullName, isActive: true },
    select: { id: true, installationId: true },
  });

  if (existing) {
    if (existing.installationId != null) {
      return { ok: false, reason: "managed-by-platform", repoId: existing.id };
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
