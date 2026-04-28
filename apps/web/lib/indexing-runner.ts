import { prisma } from "@octopus/db";
import { pubby } from "@/lib/pubby";
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
  provider: string = "github",
) {
  try {
    const { indexRepository: runIndexing } = await import("@/lib/indexer");
    const stats = await runIndexing(
      repoId,
      fullName,
      defaultBranch,
      installationId,
      emitLog,
      abortController.signal,
      provider,
      organizationId,
    );

    await prisma.repository.update({
      where: { id: repoId },
      data: {
        indexStatus: "indexed",
        indexedAt: new Date(),
        totalFiles: stats.totalFiles,
        indexedFiles: stats.indexedFiles,
        totalChunks: stats.totalChunks,
        totalVectors: stats.totalVectors,
        contributorCount: stats.contributorCount,
        contributors: JSON.parse(JSON.stringify(stats.contributors)),
        indexDurationMs: stats.durationMs,
        ...(stats.resolvedDefaultBranch ? { defaultBranch: stats.resolvedDefaultBranch } : {}),
      },
    });

    emitLog(`Indexing completed for ${fullName}`, "success");

    // Generate summary with AI
    emitLog("Generating repository summary with AI...");
    try {
      const { summarizeRepository } = await import("@/lib/summarizer");
      const { summary, purpose } = await summarizeRepository(repoId, fullName, organizationId);

      await prisma.repository.update({
        where: { id: repoId },
        data: { summary, purpose },
      });

      emitLog("Repository summary generated", "success");
    } catch (summarizeError) {
      console.error("Failed to generate summary:", summarizeError);
      emitLog("Summary generation failed (indexing still succeeded)", "warning");
    }

    clearAbortController(repoId);

    eventBus.emit({
      type: "repo-indexed",
      orgId: organizationId,
      repoFullName: fullName,
      success: true,
      indexedFiles: stats.indexedFiles,
      totalVectors: stats.totalVectors,
      durationMs: stats.durationMs,
    });

    pubby.trigger(channel, "index-status", {
      repoId,
      status: "indexed",
    });
  } catch (error) {
    clearAbortController(repoId);

    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    const isCancelled = errorMsg === "Indexing cancelled";

    console.error(`Failed to index repo ${fullName}:`, error);
    await prisma.repository.update({
      where: { id: repoId },
      data: { indexStatus: isCancelled ? "pending" : "failed" },
    });

    if (isCancelled) {
      emitLog("Indexing cancelled by user", "warning");
      pubby.trigger(channel, "index-status", {
        repoId,
        status: "cancelled",
      });
    } else {
      const needsAccess = errorMsg.includes("does not have access");
      emitLog(`Indexing failed: ${errorMsg}`, "error");
      eventBus.emit({
        type: "repo-indexed",
        orgId: organizationId,
        repoFullName: fullName,
        success: false,
        error: errorMsg,
      });
      pubby.trigger(channel, "index-status", {
        repoId,
        status: "failed",
        needsAccess,
      });
    }
  }
}
