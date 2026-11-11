import "server-only";
import { prisma, type Prisma } from "@octopus/db";
import type { IndexStats } from "@/lib/indexer";
import type { SyncLogEntry } from "@/lib/elasticsearch";
import { safeIndexLogMessage } from "@/lib/index-log-safety";

/** A replacement attempt or cancellation owns the row now. */
export class SupersededIndexError extends Error {
  constructor() { super("Indexing attempt is no longer current"); }
}

/**
 * GitHub answers 451 on the tree request when the repository itself is
 * unavailable for legal reasons; retrying cannot help. Set only there: other
 * dependencies (embeddings) also raise errors with an HTTP status.
 */
export function isProviderBlock(error: unknown): boolean {
  return (error as { providerBlock?: unknown } | null)?.providerBlock === true;
}

export function isIndexingCancelled(signal?: AbortSignal): boolean {
  return !!signal?.aborted && signal.reason?.name !== "TimeoutError";
}

/** Persist a complete snapshot and its milestones in one guarded transaction. */
export async function runRepositoryIndex(
  repositoryId: string,
  indexAttemptId: string,
  work: () => Promise<IndexStats>,
  signal?: AbortSignal,
  onFailure?: (tx: Prisma.TransactionClient, error: unknown) => Promise<void>,
): Promise<IndexStats> {
  const where = { id: repositoryId, indexStatus: "indexing", indexAttemptId };
  try {
    const attempt = await prisma.repository.findUniqueOrThrow({
      where: { id: repositoryId }, select: { indexStatus: true, indexAttemptId: true },
    });
    if (attempt.indexStatus !== "indexing" || attempt.indexAttemptId !== indexAttemptId) {
      throw new SupersededIndexError();
    }
    signal?.throwIfAborted();
    const stats = await work();
    signal?.throwIfAborted();
    if (stats.totalChunks !== stats.totalVectors || stats.totalChunks < 0 ||
        (stats.totalChunks > 0 && stats.indexedFiles <= 0)) {
      throw new Error("Indexing incomplete: invalid completion statistics");
    }
    await prisma.$transaction(async tx => {
      signal?.throwIfAborted();
      const saved = await tx.repository.updateMany({ where, data: {
        indexStatus: "indexed",
        indexBlockedAt: null,
        activeIndexGeneration: indexAttemptId,
        totalFiles: stats.totalFiles, indexedFiles: stats.indexedFiles,
        totalChunks: stats.totalChunks, totalVectors: stats.totalVectors,
        contributorCount: stats.contributorCount,
        contributors: JSON.parse(JSON.stringify(stats.contributors)),
        indexDurationMs: stats.durationMs,
        ...(stats.resolvedDefaultBranch ? { defaultBranch: stats.resolvedDefaultBranch } : {}),
      } });
      if (saved.count !== 1) throw new SupersededIndexError();
      signal?.throwIfAborted();
      // Empty snapshots are valid for reviewing a first PR, but deliver no
      // indexed content. Leave existing dates unchanged.
      if (stats.indexedFiles > 0 && stats.totalChunks > 0 && stats.totalVectors === stats.totalChunks) {
        await recordRepositoryIndexCompletion(tx, repositoryId);
      }
    });
    return stats;
  } catch (error) {
    // Never let an expired worker overwrite its replacement's state.
    const data = { indexStatus: isIndexingCancelled(signal) ? "pending" : "failed",
      ...(isProviderBlock(error) ? { indexBlockedAt: new Date() } : {}) };
    const released = onFailure && !signal?.aborted
      ? await prisma.$transaction(async tx => {
        const result = await tx.repository.updateMany({ where, data });
        if (result.count) await onFailure(tx, error);
        return result;
      })
      : await prisma.repository.updateMany({ where, data });
    if (!released.count) throw new SupersededIndexError();
    signal?.throwIfAborted();
    throw error;
  }
}

/** Only call inside the transaction that commits a verified full snapshot. */
export async function recordRepositoryIndexCompletion(
  tx: Prisma.TransactionClient,
  repositoryId: string,
  completedAt: Date = new Date(),
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "repositories"
    SET "firstIndexedAt" = CASE
          WHEN "firstIndexedAt" IS NOT NULL
            THEN LEAST("firstIndexedAt", ${completedAt}::timestamp)
          WHEN "indexedAt" IS NULL THEN ${completedAt}::timestamp
          ELSE NULL
        END,
        "indexedAt" = ${completedAt}::timestamp,
        "updatedAt" = ${completedAt}::timestamp
    WHERE "id" = ${repositoryId}
  `;
}

export function getSyncLogAttempt(repo: { indexAttemptId: string | null; syncLogAttemptId: string | null; localIndexUpload: unknown }): string | undefined {
  const marker = repo.syncLogAttemptId;
  if (!marker) return undefined;
  if (repo.indexAttemptId === marker) return marker;
  const upload = repo.localIndexUpload;
  if (!upload || typeof upload !== "object" || Array.isArray(upload)) return undefined;
  const state = upload as { id?: unknown; batchAttemptId?: unknown };
  if (state.id === marker && (repo.indexAttemptId === null || state.batchAttemptId === repo.indexAttemptId)) return marker;
  return undefined;
}

export function safeSyncLogs(logs: SyncLogEntry[], orgId: string, repoId: string, attempt?: string): SyncLogEntry[] {
  return logs.map(log => ({
    orgId, repoId,
    ...(attempt && log.indexAttemptId === attempt ? { indexAttemptId: attempt } : {}),
    message: safeIndexLogMessage(log.message),
    level: ["info", "success", "warning", "error"].includes(log.level) ? log.level : "info",
    timestamp: typeof log.timestamp === "number" && Number.isFinite(log.timestamp) ? log.timestamp : 0,
  }));
}
