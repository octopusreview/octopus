import "server-only";
import { reportBackgroundFailure } from "./background-failure";
import { runRepositoryIndex, SupersededIndexError, isIndexingCancelled } from "@/lib/repository-index-completion";
import { prisma } from "@octopus/db";
import { notifyRepositoryIndex } from "@/lib/repository-index-notifications";
import { clearAbortController } from "@/lib/indexing-abort";
import { eventBus } from "@/lib/events";
import type { LogLevel } from "@/lib/indexer";

export async function runIndexingInBackground(
  repoId: string,
  fullName: string,
  defaultBranch: string,
  organizationId: string,
  installationId: number,
  channel: string,
  emitLog: (message: string, level?: LogLevel) => void,
  abortController: AbortController,
  indexAttemptId: string,
  provider: string = "github",
) {
  try {
    const stats = await runRepositoryIndex(repoId, indexAttemptId, async () => {
      const { indexRepository: runIndexing } = await import("@/lib/indexer");
      void notifyRepositoryIndex(channel, repoId);
      emitLog("Starting indexing");
      return runIndexing(
        { repoId, indexAttemptId }, fullName, defaultBranch, installationId, emitLog,
        abortController.signal, provider, organizationId,
      );
    }, abortController.signal);

    emitLog("Indexing complete", "success");

    // Generate summary with AI
    emitLog("Generating repository summary with AI...");
    try {
      const { summarizeRepository } = await import("@/lib/summarizer");
      const { summary, purpose } = await summarizeRepository(repoId, fullName, organizationId);

      await prisma.repository.updateMany({
        where: { id: repoId, indexStatus: "indexed", indexAttemptId },
        data: { summary, purpose },
      });

      emitLog("Repository summary generated", "success");
    } catch {
      console.error("Failed to generate summary");
      emitLog("Summary generation failed (indexing still succeeded)", "warning");
    }

    clearAbortController(indexAttemptId);

    const current = await prisma.repository.findUnique({ where: { id: repoId }, select: { indexAttemptId: true, indexStatus: true } });
    if (current?.indexAttemptId !== indexAttemptId || current.indexStatus !== "indexed") return;

    eventBus.emit({
      type: "repo-indexed",
      orgId: organizationId,
      repoFullName: fullName,
      success: true,
      indexedFiles: stats.indexedFiles,
      totalVectors: stats.totalVectors,
      durationMs: stats.durationMs,
    });

    void notifyRepositoryIndex(channel, repoId);
  } catch (error) {
    clearAbortController(indexAttemptId);
    if (error instanceof SupersededIndexError) return;

    const errorMsg = "Indexing failed";
    const isCancelled = isIndexingCancelled(abortController.signal);

    console.error("Failed to index repository");

    if (isCancelled) {
      emitLog("Indexing cancelled by user", "warning");
      void notifyRepositoryIndex(channel, repoId);
    } else {
      reportBackgroundFailure(error, { stage: "indexing", repositoryId: repoId, attemptId: indexAttemptId });
      emitLog("Indexing failed", "error");
      eventBus.emit({
        type: "repo-indexed",
        orgId: organizationId,
        repoFullName: fullName,
        success: false,
        error: errorMsg,
      });
      void notifyRepositoryIndex(channel, repoId);
    }
  }
}
