import "server-only";
import { randomUUID } from "node:crypto";
import { runRepositoryIndex } from "@/lib/repository-index-completion";
import { prisma } from "@octopus/db";
import { generateLocalReview } from "@/lib/review-core";
import { indexRepository } from "@/lib/indexer";
import { summarizeRepository } from "@/lib/summarizer";
import { analyzeRepository } from "@/lib/analyzer";
import { getRepositoryTree, getPullRequestDiff } from "@/lib/github";
import { buildGeneratedMatcher, splitDiffByIgnore } from "@/lib/generated-files";
import { truncateDiff } from "@/lib/diff-truncate";
import { eventBus } from "@/lib/events/bus";
import { persistCommunityReviewToPR, CommunityRepositoryChangedError } from "@/lib/community-pr-persist";
import { clearTerminalCommunityJobToken, completeCommunityReviewJob } from "@/lib/community-review-completion";
import { decryptString } from "@/lib/crypto";
import { getBotToken } from "@/lib/oss-bot";
import { postOssReview } from "@/lib/oss-review-post";

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

  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    await clearTerminalCommunityJobToken(job);
    LOG(jobId, `already in terminal state (${job.status}), skipping`);
    return;
  }

  const now = new Date();
  if (job.expiresAt < now) {
    LOG(jobId, "expired before processing, marking failed");
    const updated = await prisma.communityReviewJob.updateMany({
      where: { id: jobId, organizationId: job.organizationId, repositoryId: job.repositoryId,
        status: { notIn: ["completed", "failed", "cancelled"] }, expiresAt: { lt: now } },
      data: { status: "failed", errorMessage: "Job expired before processing", completedAt: now, githubToken: null },
    });
    if (updated.count === 0) await clearTerminalCommunityJobToken(job);
    return;
  }

  const activeJob = { id: jobId, organizationId: job.organizationId, repositoryId: job.repositoryId,
    status: { notIn: ["completed", "failed", "cancelled"] } };
  const started = await prisma.communityReviewJob.updateMany({
    where: activeJob,
    data: {
      startedAt: job.startedAt ?? new Date(),
      attempts: { increment: 1 },
    },
  });
  if (!started.count) {
    await clearTerminalCommunityJobToken(job);
    return;
  }

  try {
    const repo = await prisma.repository.findUnique({ where: { id: job.repositoryId } });
    if (!repo || repo.organizationId !== job.organizationId || repo.provider !== "github" ||
        repo.fullName.toLowerCase() !== job.repoFullName.toLowerCase()) {
      throw new CommunityRepositoryChangedError("Repository ownership changed before community review");
    }

    // bot_account mode authenticates with the shared bot PAT (server posts the review
    // itself); action_client mode uses the short-lived token the Action captured.
    const isBotAccount = job.postMode === "bot_account";
    let githubToken: string;
    if (isBotAccount) {
      githubToken = getBotToken();
    } else {
      if (!job.githubToken) {
        throw new Error("githubToken missing on job (cannot fetch repo); job rejected");
      }
      try {
        githubToken = decryptString(job.githubToken);
      } catch (err) {
        ERR(jobId, "githubToken decrypt failed:", err);
        throw new Error("githubToken decrypt failed");
      }
    }

    const fullName = job.repoFullName;
    LOG(jobId, `repo=${fullName} indexStatus=${repo.indexStatus}`);

    // ── Phase 1: Indexing (with atomic claim) ─────────────────────────────

    let needsIndex = repo.indexStatus !== "indexed";

    if (needsIndex) {
      const indexAttemptId = randomUUID();
      // Atomic claim
      const claim = await prisma.repository.updateMany({
        where: { id: repo.id, indexStatus: { notIn: ["indexed", "indexing"] } },
        data: { indexStatus: "indexing", indexAttemptId },
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
            data: { indexStatus: "indexing", indexAttemptId },
          });
          if (reclaim.count === 0) {
            throw new Error(`Could not reclaim indexing for ${fullName}`);
          }
        } else {
          needsIndex = false;
        }
      }

      if (needsIndex) {
        const transitionLost = new Error("Community review is no longer active");
        try {
          const indexStats = await runRepositoryIndex(repo.id, indexAttemptId, async () => {
            const updated = await prisma.communityReviewJob.updateMany({ where: activeJob, data: { status: "indexing" } });
            if (!updated.count) throw transitionLost;
            LOG(jobId, "indexing repository...");
            return indexRepository(
              { repoId: repo.id, indexAttemptId }, fullName, repo.defaultBranch, 0,
              () => {},
              undefined, "github", job.organizationId, githubToken,
            );
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
          } catch {
            ERR(jobId, "summarize failed (non-fatal)");
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
          } catch {
            ERR(jobId, "analyze failed (non-fatal)");
          }
        } catch (err) {
          if (err === transitionLost) {
            await clearTerminalCommunityJobToken(job);
            return;
          }
          ERR(jobId, "indexing failed");
          // Continue — generateLocalReview works without index
        }
      }
    }

    // ── Phase 2: Review ───────────────────────────────────────────────────

    const reviewing = await prisma.communityReviewJob.updateMany({
      where: activeJob,
      data: { status: "reviewing" },
    });
    if (!reviewing.count) {
      await clearTerminalCommunityJobToken(job);
      return;
    }

    let fileTree: string[] | undefined;
    try {
      const [ownerPart, repoPart] = fullName.split("/");
      fileTree = await getRepositoryTree(0, ownerPart, repoPart, repo.defaultBranch, githubToken);
    } catch (err) {
      LOG(jobId, "fileTree fetch failed (non-fatal):", err);
    }

    // bot_account mode does not receive a diff from the Action (the workflow grants no
    // token); fetch it server-side with the bot token.
    let diff = job.diff;
    if (isBotAccount && (!diff || diff.trim().length === 0) && job.prNumber != null) {
      const [ownerPart, repoPart] = fullName.split("/");
      diff = await getPullRequestDiff(0, ownerPart, repoPart, job.prNumber, githubToken);
    }

    // Exclude generated files (defaults) before the review cap so a large
    // generated file can't crowd real files out of the review (#1429). Then cap
    // to the review size (the fetch ceiling above is larger).
    {
      const { kept, skipped } = splitDiffByIgnore(diff ?? "", buildGeneratedMatcher());
      diff = truncateDiff(kept);
      if (skipped.length > 0) {
        LOG(jobId, `excluded ${skipped.length} generated file(s): ${skipped.slice(0, 10).join(", ")}`);
      }
    }

    LOG(jobId, "generating review...");
    const reviewResult = await generateLocalReview({
      diff,
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
          organizationId: job.organizationId,
          externalId: repo.externalId,
          fullName,
          prNumber: job.prNumber,
          prTitle: job.prTitle,
          prAuthor: job.prAuthor,
          headSha: job.headSha,
          summary: reviewResult.summary,
          findings: reviewResult.findings,
        });
      } catch (persistErr) {
        if (persistErr instanceof CommunityRepositoryChangedError) throw persistErr;
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

    // bot_account mode: the server posts the review as the bot user account. Posting
    // failure is logged but does not fail the job — re-running would risk a duplicate
    // comment, and the review is already persisted to the PR record.
    if (isBotAccount && job.prNumber != null) {
      try {
        const [ownerPart, repoPart] = fullName.split("/");
        const { posted, skipped } = await postOssReview({
          owner: ownerPart,
          repo: repoPart,
          prNumber: job.prNumber,
          findings: reviewResult.findings,
          diff,
          summary: reviewResult.summary,
          botToken: githubToken,
        });
        LOG(jobId, `bot-account posted: ${posted} inline, ${skipped} skipped`);
      } catch (postErr) {
        ERR(jobId, "bot-account post failed (non-fatal):", postErr);
      }
    }

    await completeCommunityReviewJob(jobId, {
      repositoryId: repo.id, organizationId: job.organizationId, externalId: repo.externalId, fullName,
    }, {
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
    });

    LOG(jobId, `completed: ${reviewResult.findings.length} findings`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ERR(jobId, "fatal:", err);
    const updated = await prisma.communityReviewJob.updateMany({
      where: { id: jobId, organizationId: job.organizationId, repositoryId: job.repositoryId,
        status: { notIn: ["completed", "failed", "cancelled"] } },
      data: {
        status: "failed",
        errorMessage: message.slice(0, 1000),
        completedAt: new Date(),
        githubToken: null,
      },
    });
    if (updated.count === 0) await clearTerminalCommunityJobToken(job);
    throw err;
  }
}
