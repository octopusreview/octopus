import "server-only";
import { reportBackgroundFailure, type RetryState } from "./background-failure";
import { indexingMilestone, type IndexingMilestone } from "./indexing-milestone";
import { createHash, randomUUID } from "node:crypto";
import { runRepositoryIndex, SupersededIndexError, isIndexingCancelled } from "@/lib/repository-index-completion";
import { prisma } from "@octopus/db";
import { enqueue } from "@/lib/queue";
import type { LogLevel } from "@/lib/indexer";
import { notifyRepositoryIndex } from "@/lib/repository-index-notifications";
import { deleteSyncLogs, writeSyncLog } from "@/lib/elasticsearch";
import { createAbortController, clearAbortController } from "@/lib/indexing-abort";
import { GitHubIndexDeferredError } from "@/lib/github-index-fetch";
import { rememberDeferredIndex } from "@/lib/github-deferred-index";

export interface RepositoryIndexJob {
  repositoryId: string;
  organizationId: string;
  expectedAttemptId?: string;
}

function deferredJobAttemptId(jobId: string, retryCount: number): string {
  const bytes = createHash("sha256").update(`github-deferred-index:${jobId}:${retryCount}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Revisit empty snapshots as well: a repository can be discovered before its
// first push. Failed enqueues remain eligible for the next discovery sweep.
const needsIndex = {
  OR: [
    { indexStatus: { in: ["pending", "failed"] } },
    { indexStatus: "indexed", totalFiles: 0 },
  ],
};

export async function enqueuePendingRepositoryIndexes(organizationId: string, repositoryId?: string, providers?: string[]) {
  const eligibleProviders = ["github", "forgejo"].filter(provider => !providers || providers.includes(provider));
  if (!eligibleProviders.length) return;
  const repos = await prisma.repository.findMany({
    where: {
      organizationId,
      ...(repositoryId ? { id: repositoryId } : {}),
      provider: { in: eligibleProviders },
      isActive: true,
      dismissedAt: null,
      organization: { deletedAt: null, bannedAt: null, autoDiscoverRepos: true },
      ...needsIndex,
    },
    select: { id: true },
    orderBy: { indexedAt: { sort: "asc", nulls: "first" } },
    take: 200,
  });
  for (const repo of repos) {
    await enqueue("index-repository", { repositoryId: repo.id, organizationId }, {
      singletonKey: repo.id,
      singletonSeconds: 60,
    });
  }
}

export async function processRepositoryIndex(job: RepositoryIndexJob, retry?: RetryState, jobId?: string) {
  if (!job || typeof job.repositoryId !== "string" || !job.repositoryId ||
      typeof job.organizationId !== "string" || !job.organizationId) {
    throw new Error("Repository indexing requires repositoryId and organizationId");
  }
  const deferred = job.expectedAttemptId !== undefined;
  if (deferred && (typeof job.expectedAttemptId !== "string" || !job.expectedAttemptId ||
      !jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId) ||
      !Number.isSafeInteger(retry?.retryCount) || (retry?.retryCount ?? -1) < 0)) {
    throw new Error("Deferred repository indexing requires a valid job identity");
  }
  const expectedAttempts = deferred && jobId ? [job.expectedAttemptId!,
    ...(retry!.retryCount > 0 ? [deferredJobAttemptId(jobId, retry!.retryCount - 1)] : []),
  ] : [];
  // Recheck ownership and standing when the job runs: the installation may
  // have been disconnected, or the repository dismissed, while it was queued.
  const repo = await prisma.repository.findFirst({
    where: {
      id: job.repositoryId,
      organizationId: job.organizationId,
      provider: { in: ["github", "forgejo"] },
      isActive: true,
      dismissedAt: null,
      ...(deferred ? { indexStatus: "failed", indexAttemptId: { in: expectedAttempts } } : {}),
      organization: { deletedAt: null, bannedAt: null, autoDiscoverRepos: true },
    },
    select: { id: true, fullName: true, defaultBranch: true, provider: true, installationId: true,
      organization: { select: { githubInstallationId: true } } },
  });
  const installationId = repo?.organization.githubInstallationId;
  if (!repo || (repo.provider === "github" && (!installationId || (repo.installationId && repo.installationId !== installationId)))) return;

  // Share the reviewer's claim so a first PR and discovery cannot both index.
  const indexAttemptId = deferred && jobId ? deferredJobAttemptId(jobId, retry!.retryCount) : randomUUID();
  const claim = await prisma.repository.updateMany({
    where: { id: repo.id, organizationId: job.organizationId, provider: repo.provider,
      installationId: repo.installationId, isActive: true, dismissedAt: null,
      organization: { deletedAt: null, bannedAt: null, autoDiscoverRepos: true,
        ...(repo.provider === "github" ? { githubInstallationId: installationId } : {}) },
      ...(deferred ? { indexStatus: "failed", indexAttemptId: { in: expectedAttempts } } : needsIndex) },
    data: { indexStatus: "indexing", indexAttemptId },
  });
  if (!claim.count) return;

  const controller = createAbortController(indexAttemptId);
  // Abort before pg-boss expires the attempt, so the catch can release its claim.
  const deadlineError = new DOMException("Repository indexing timed out", "TimeoutError");
  const timeout = setTimeout(() => controller.abort(deadlineError), 25 * 60_000);
  const channel = `presence-org-${job.organizationId}`;
  let lastMilestone: IndexingMilestone = "not_recorded";
  const log = (message: string, level: LogLevel = "info") => {
    lastMilestone = indexingMilestone(message) ?? lastMilestone;
    writeSyncLog({ orgId: job.organizationId, repoId: repo.id, message, level, timestamp: Date.now() });
  };
  try {
    const stats = await runRepositoryIndex(repo.id, indexAttemptId, async () => {
      const { indexRepository } = await import("@/lib/indexer");
      await deleteSyncLogs(job.organizationId, repo.id);
      void notifyRepositoryIndex(channel, repo.id);
      return indexRepository(
        { repoId: repo.id, indexAttemptId }, repo.fullName, repo.defaultBranch, installationId ?? 0, log,
        controller.signal, repo.provider, job.organizationId,
      );
    }, controller.signal, async (tx, error) => {
      if (error instanceof GitHubIndexDeferredError && repo.provider === "github" && installationId && !controller.signal.aborted) {
        await rememberDeferredIndex(tx, { repositoryId: repo.id, organizationId: job.organizationId, installationId, indexAttemptId });
      }
    });
    log(`Indexing complete: ${stats.indexedFiles} files, ${stats.totalVectors} vectors`, "success");
    void notifyRepositoryIndex(channel, repo.id);
  } catch (error) {
    if (error instanceof SupersededIndexError) return;
    const isCancelled = isIndexingCancelled(controller.signal);
    log(error instanceof GitHubIndexDeferredError && error.paused
      ? error.message : `Indexing failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    void notifyRepositoryIndex(channel, repo.id);
    if (error instanceof GitHubIndexDeferredError && !controller.signal.aborted && repo.provider === "github" && installationId) return;
    if (!isCancelled) {
      reportBackgroundFailure(error, { stage: "indexing", attemptId: indexAttemptId, repositoryId: repo.id, retry,
        indexingDeadline: error === deadlineError && controller.signal.reason === deadlineError, indexingLastMilestone: lastMilestone });
      throw error;
    }
  } finally {
    clearTimeout(timeout);
    clearAbortController(indexAttemptId);
  }
}
