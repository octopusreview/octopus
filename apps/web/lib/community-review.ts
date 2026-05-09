import { prisma } from "@octopus/db";
import { generateLocalReview } from "@/lib/review-core";
import { indexRepository } from "@/lib/indexer";
import { summarizeRepository } from "@/lib/summarizer";
import { analyzeRepository } from "@/lib/analyzer";
import { getRepositoryTree } from "@/lib/github";
import { eventBus } from "@/lib/events/bus";
import { persistCommunityReviewToPR } from "@/lib/community-pr-persist";

const LOG = (jobId: string, msg: string, ...rest: unknown[]) =>
  console.log(`[community-review] [${jobId}] ${msg}`, ...rest);
const ERR = (jobId: string, msg: string, ...rest: unknown[]) =>
  console.error(`[community-review] [${jobId}] ${msg}`, ...rest);

export interface CommunityReviewJobData {
  jobId: string;
}

export async function processCommunityReview(jobId: string): Promise<void> {
  LOG(jobId, "starting");

  const job = await prisma.communityReviewJob.findUnique({ where: { id: jobId } });
  if (!job) {
    ERR(jobId, "job not found, abort");
    return;
  }

  if (job.status === "completed" || job.status === "failed") {
    LOG(jobId, `already in terminal state (${job.status}), skipping`);
    return;
  }

  if (job.expiresAt < new Date()) {
    LOG(jobId, "expired before processing, marking failed");
    await prisma.communityReviewJob.update({
      where: { id: jobId },
      data: { status: "failed", errorMessage: "Job expired before processing", completedAt: new Date() },
    });
    return;
  }

  await prisma.communityReviewJob.update({
    where: { id: jobId },
    data: {
      startedAt: job.startedAt ?? new Date(),
      attempts: { increment: 1 },
    },
  });

  try {
    const repo = await prisma.repository.findUnique({ where: { id: job.repositoryId } });
    if (!repo) throw new Error(`Repository ${job.repositoryId} not found`);

    const githubToken = job.githubToken;
    if (!githubToken) {
      throw new Error("githubToken missing on job (cannot fetch repo); job rejected");
    }

    const fullName = job.repoFullName;
    LOG(jobId, `repo=${fullName} indexStatus=${repo.indexStatus}`);

    // ── Phase 1: Indexing (with atomic claim) ─────────────────────────────

    let needsIndex = repo.indexStatus !== "indexed";

    if (needsIndex) {
      // Atomic claim
      const claim = await prisma.repository.updateMany({
        where: { id: repo.id, indexStatus: { notIn: ["indexed", "indexing"] } },
        data: { indexStatus: "indexing" },
      });

      if (claim.count === 0) {
        // Either already indexed or another worker is indexing
        const fresh = await prisma.repository.findUnique({
          where: { id: repo.id },
          select: { indexStatus: true },
        });
        const cur = fresh?.indexStatus ?? "failed";
        LOG(jobId, `claim lost, current indexStatus=${cur}`);

        if (cur === "indexing") {
          // Yield: throw so pg-boss retries after a delay.
          throw new Error("Repository is currently being indexed by another worker — will retry");
        }
        if (cur !== "indexed") {
          // failed/stale: try to reclaim
          const reclaim = await prisma.repository.updateMany({
            where: { id: repo.id, indexStatus: { notIn: ["indexed", "indexing"] } },
            data: { indexStatus: "indexing" },
          });
          if (reclaim.count === 0) {
            throw new Error(`Could not reclaim indexing for ${fullName}`);
          }
        } else {
          needsIndex = false;
        }
      }

      if (needsIndex) {
        await prisma.communityReviewJob.update({
          where: { id: jobId },
          data: { status: "indexing" },
        });

        LOG(jobId, "indexing repository...");
        try {
          const indexStats = await indexRepository(
            repo.id,
            fullName,
            repo.defaultBranch,
            0,
            (msg, level) => LOG(jobId, `[index] ${level ?? "info"}: ${msg}`),
            undefined,
            "github",
            job.organizationId,
            githubToken,
          );

          await prisma.repository.update({
            where: { id: repo.id },
            data: {
              indexStatus: "indexed",
              indexedAt: new Date(),
              indexedFiles: indexStats.indexedFiles,
              totalFiles: indexStats.totalFiles,
              totalChunks: indexStats.totalChunks,
              totalVectors: indexStats.totalVectors,
              indexDurationMs: indexStats.durationMs,
              contributorCount: indexStats.contributorCount,
              contributors: JSON.parse(JSON.stringify(indexStats.contributors)),
              ...(indexStats.resolvedDefaultBranch
                ? { defaultBranch: indexStats.resolvedDefaultBranch }
                : {}),
            },
          });

          LOG(jobId, `index done: ${indexStats.indexedFiles} files, ${indexStats.totalVectors} vectors`);

          // Best-effort summarize + analyze
          try {
            const { summary, purpose } = await summarizeRepository(repo.id, fullName, job.organizationId);
            await prisma.repository.update({
              where: { id: repo.id },
              data: { summary, purpose },
            });
            LOG(jobId, "summarize done");
          } catch (err) {
            ERR(jobId, "summarize failed (non-fatal):", err);
          }

          try {
            const analysis = await analyzeRepository(repo.id, fullName, job.organizationId);
            await prisma.repository.update({
              where: { id: repo.id },
              data: { analysis, analysisStatus: "analyzed", analyzedAt: new Date() },
            });
            eventBus.emit({
              type: "repo-analyzed",
              orgId: job.organizationId,
              repoFullName: fullName,
            });
            LOG(jobId, "analyze done");
          } catch (err) {
            ERR(jobId, "analyze failed (non-fatal):", err);
          }
        } catch (err) {
          ERR(jobId, "indexing failed:", err);
          await prisma.repository.update({
            where: { id: repo.id },
            data: { indexStatus: "failed" },
          });
          // Continue — generateLocalReview works without index
        }
      }
    }

    // ── Phase 2: Review ───────────────────────────────────────────────────

    await prisma.communityReviewJob.update({
      where: { id: jobId },
      data: { status: "reviewing" },
    });

    let fileTree: string[] | undefined;
    try {
      const [ownerPart, repoPart] = fullName.split("/");
      fileTree = await getRepositoryTree(0, ownerPart, repoPart, repo.defaultBranch, githubToken);
    } catch (err) {
      LOG(jobId, "fileTree fetch failed (non-fatal):", err);
    }

    LOG(jobId, "generating review...");
    const reviewResult = await generateLocalReview({
      diff: job.diff,
      repoId: repo.id,
      orgId: job.organizationId,
      title: job.prTitle ?? undefined,
      author: job.prAuthor ?? undefined,
      fileTree,
      operation: "community-review",
      prNumber: job.prNumber ?? undefined,
    });

    let firstCommunityReview = false;
    const existingPRCount = await prisma.pullRequest.count({
      where: { repositoryId: repo.id },
    });
    firstCommunityReview = existingPRCount === 0;

    if (job.prNumber != null) {
      try {
        await persistCommunityReviewToPR({
          repositoryId: repo.id,
          fullName,
          prNumber: job.prNumber,
          prTitle: job.prTitle,
          prAuthor: job.prAuthor,
          headSha: job.headSha,
          summary: reviewResult.summary,
          findings: reviewResult.findings,
        });
      } catch (persistErr) {
        ERR(jobId, "persist community PR failed (non-fatal):", persistErr);
      }
    }

    eventBus.emit({
      type: "community-review",
      orgId: job.organizationId,
      repoFullName: fullName,
      prNumber: job.prNumber ?? undefined,
      findingsCount: reviewResult.findings.length,
    });

    await prisma.communityReviewJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        findings: JSON.parse(JSON.stringify(reviewResult.findings)),
        summary: reviewResult.summary,
        model: reviewResult.model,
        indexed: needsIndex,
        firstCommunityReview,
        usage: reviewResult.usage ? JSON.parse(JSON.stringify(reviewResult.usage)) : undefined,
        completedAt: new Date(),
        // Clear short-lived secret once we no longer need it
        githubToken: null,
      },
    });

    LOG(jobId, `completed: ${reviewResult.findings.length} findings`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ERR(jobId, "fatal:", err);
    await prisma.communityReviewJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        errorMessage: message.slice(0, 1000),
        completedAt: new Date(),
        githubToken: null,
      },
    });
    throw err;
  }
}
