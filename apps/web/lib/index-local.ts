import "server-only";
import { recordRepositoryIndexCompletion } from "@/lib/repository-index-completion";
import crypto from "node:crypto";
import { prisma } from "@octopus/db";
import { chunkText, shouldIndex, MAX_FILE_SIZE } from "@/lib/index-chunking";
import { createEmbeddings } from "@/lib/embeddings";
import { generateSparseVectors } from "@/lib/sparse-vector";
import { upsertChunks } from "@/lib/qdrant";
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

/**
 * Time after which an "indexing"-status repo is considered abandoned and
 * may be re-claimed. Exported so the route's error message can quote the
 * exact same value the guard uses — without this the message would drift
 * out of sync with the guard.
 */
export const IN_FLIGHT_WINDOW_MS = 5 * 60 * 1000;

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
  claim: { attemptId: string; upload: { id: string } },
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

  await upsertChunks(points, { repoId, indexAttemptId: claim.attemptId, uploadId: claim.upload.id });

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
  upload: { totalBatches: number; totalFiles: number },
): Promise<
  | { ok: true; repoId: string; reIndex: boolean; uploadId: string }
  | { ok: false; reason: "managed-by-platform"; repoId: string }
  | { ok: false; reason: "in-flight"; repoId: string }
  | { ok: false; reason: "repository-changed" }
> {
  const existing = await prisma.repository.findFirst({
    where: { organizationId, provider, fullName, isActive: true },
    select: { id: true, installationId: true, externalId: true, indexStatus: true, updatedAt: true },
  });
  const externalId = existing?.externalId ?? `cli:${provider}:${fullName}`;
  const uploadState = {
    id: crypto.randomUUID(), nextBatch: 0, totalBatches: upload.totalBatches,
    totalFiles: upload.totalFiles, paths: [] as string[], verified: true,
    organizationId, provider, fullName, externalId,
  };

  if (existing) {
    // Only ever claim CLI-created rows (externalId "cli:<provider>:<fullName>").
    // A row with an installationId OR any non-`cli:` externalId is managed by the
    // platform webhook / GitHub-Action flow (the Action creates rows with a
    // numeric externalId and installationId=null) — never hijack those.
    if (existing.installationId != null || !existing.externalId?.startsWith("cli:")) {
      return { ok: false, reason: "managed-by-platform", repoId: existing.id };
    }
    const inFlightCutoff = new Date(Date.now() - IN_FLIGHT_WINDOW_MS);
    const claim = await prisma.repository.updateMany({
      where: {
        id: existing.id,
        organizationId,
        provider,
        fullName,
        isActive: true,
        installationId: null,
        externalId: existing.externalId,
        OR: [
          { indexStatus: { not: "indexing" } },
          { updatedAt: { lt: inFlightCutoff } },
        ],
      },
      data: {
        indexStatus: "indexing",
        localIndexUpload: uploadState,
        indexAttemptId: null,
        indexedFiles: 0,
        totalFiles: 0,
        totalChunks: 0,
        totalVectors: 0,
        indexDurationMs: null,
      },
    });
    if (claim.count === 0) {
      const current = await prisma.repository.findFirst({
        where: { id: existing.id, organizationId, provider, fullName, isActive: true, installationId: null, externalId: existing.externalId },
        select: { id: true },
      });
      if (!current) return { ok: false, reason: "repository-changed" };
      return { ok: false, reason: "in-flight", repoId: existing.id };
    }
    return { ok: true, repoId: existing.id, reIndex: true, uploadId: uploadState.id };
  }

  // New row. `externalId` would normally be the platform's repo ID — we don't
  // have one, so fingerprint the local identity as `cli:<provider>:<fullName>`
  // to satisfy the unique constraint without colliding with platform-managed rows.
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
      localIndexUpload: uploadState,
    },
    select: { id: true },
  });
  return { ok: true, repoId: repo.id, reIndex: false, uploadId: uploadState.id };
}

type UploadState = {
  id: string;
  nextBatch: number;
  totalBatches: number;
  totalFiles: number;
  paths: string[];
  verified: boolean;
  organizationId: string;
  provider: string;
  fullName: string;
  externalId: string;
};

export class LocalIndexConflict extends Error {}

/** Claim one ordered batch before performing embeddings or vector writes. */
export async function claimLocalIndexBatch(
  repoId: string,
  organizationId: string,
  batchIndex: number,
  totalBatches: number,
  files: LocalFile[],
  uploadId?: string,
): Promise<{ attemptId: string; upload: UploadState }> {
  const repo = await prisma.repository.findFirst({ where: { id: repoId, organizationId, isActive: true } });
  const upload = repo?.localIndexUpload as UploadState | null | undefined;
  if (!repo || repo.installationId != null || !repo.externalId.startsWith("cli:") ||
      !upload || upload.organizationId !== repo.organizationId || upload.provider !== repo.provider ||
      upload.fullName !== repo.fullName || upload.externalId !== repo.externalId ||
      repo.indexStatus !== "indexing" || repo.indexAttemptId ||
      upload.nextBatch !== batchIndex || upload.totalBatches !== totalBatches ||
      (uploadId !== undefined && uploadId !== upload.id)) {
    throw new LocalIndexConflict("Upload is no longer current or batch is out of order");
  }
  const paths = [...upload.paths, ...files.map(file => file.path)];
  if (new Set(paths).size !== paths.length || paths.length > upload.totalFiles ||
      (batchIndex === totalBatches - 1 && paths.length !== upload.totalFiles)) {
    throw new LocalIndexConflict("Upload contains duplicate files or does not match the declared file count");
  }
  const attemptId = crypto.randomUUID();
  const claimed = await prisma.repository.updateMany({
    where: { id: repoId, organizationId, isActive: true, provider: repo.provider, fullName: repo.fullName,
      externalId: repo.externalId, installationId: null, updatedAt: repo.updatedAt, indexStatus: "indexing", indexAttemptId: null,
      localIndexUpload: { path: ["id"], equals: upload.id } },
    data: { indexAttemptId: attemptId },
  });
  if (!claimed.count) throw new LocalIndexConflict("Another batch owns this upload");
  return { attemptId, upload: {
    ...upload, paths, nextBatch: batchIndex + 1,
    verified: upload.verified && (batchIndex === 0 || uploadId === upload.id),
  } };
}

/** Final status and milestones share the same batch-ownership transaction. */
export async function recordLocalIndexProgress(
  repoId: string,
  startedAt: number | null,
  delta: { indexedFiles: number; totalChunks: number; totalVectors: number; totalFiles?: number },
  commit: boolean,
  claim: { attemptId: string; upload: UploadState },
): Promise<void> {
  await prisma.$transaction(async tx => {
    const saved = await tx.repository.updateMany({
      where: { id: repoId, indexStatus: "indexing", indexAttemptId: claim.attemptId },
      data: {
        indexAttemptId: null,
        localIndexUpload: claim.upload,
        indexedFiles: { increment: delta.indexedFiles },
        totalChunks: { increment: delta.totalChunks },
        totalVectors: { increment: delta.totalVectors },
        totalFiles: claim.upload.totalFiles,
        ...(commit ? {
          indexStatus: "indexed",
          activeIndexGeneration: claim.upload.id,
          indexDurationMs: startedAt != null ? Date.now() - startedAt : null,
        } : {}),
      },
    });
    if (!saved.count) throw new LocalIndexConflict("Upload was cancelled or replaced");
    if (!commit) return;
    const repo = await tx.repository.findUniqueOrThrow({ where: { id: repoId } });
    if (repo.totalChunks > 0 && repo.totalVectors === repo.totalChunks && repo.indexedFiles > 0) {
      if (claim.upload.verified) {
        await recordRepositoryIndexCompletion(tx, repoId);
      } else {
        // Legacy clients send no upload ID. Preserve latest-completion behavior,
        // but never infer a first-success milestone from an unverified session.
        await tx.repository.update({ where: { id: repoId }, data: { indexedAt: new Date() } });
      }
    }
  });
}

export async function markLocalIndexFailed(repoId: string, attemptId: string): Promise<void> {
  await prisma.repository.updateMany({
    where: { id: repoId, indexStatus: "indexing", indexAttemptId: attemptId },
    data: { indexStatus: "failed", indexAttemptId: null },
  });
}
