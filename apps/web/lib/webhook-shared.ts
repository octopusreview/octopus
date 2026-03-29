import { prisma } from "@octopus/db";
import { pubby } from "@/lib/pubby";
import { processReview } from "@/lib/reviewer";
import { eventBus } from "@/lib/events";
import * as github from "@/lib/github";
import * as bitbucket from "@/lib/bitbucket";

/**
 * Shared flow: upsert PR -> post placeholder comment -> notify dashboard -> start review.
 * Works for both GitHub and Bitbucket.
 */
export async function startReviewFlow(params: {
  provider: "github" | "bitbucket";
  // GitHub-specific
  installationId?: number;
  // Bitbucket-specific
  organizationId?: string;
  // Common
  repoFullName: string;
  repoId: string;
  orgId: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  prAuthor: string;
  headSha: string;
  triggerCommentId: number;
  triggerCommentBody: string;
}) {
  const {
    provider,
    installationId,
    organizationId,
    repoFullName,
    repoId,
    orgId,
    prNumber,
    prTitle,
    prUrl,
    prAuthor,
    headSha,
    triggerCommentId,
    triggerCommentBody,
  } = params;

  const [owner, repoName] = repoFullName.split("/");

  // Check if reviews are paused for this organization
  const [org, systemConfig] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { reviewsPaused: true, blockedAuthors: true },
    }),
    prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: { blockedAuthors: true },
    }),
  ]);

  if (org?.reviewsPaused) {
    console.log(`[webhook] Reviews paused for org ${orgId}, skipping PR #${prNumber}`);
    return;
  }

  // Check existing PR status to prevent duplicate reviews (cheap indexed lookup first)
  const existingPr = await prisma.pullRequest.findUnique({
    where: {
      repositoryId_number: { repositoryId: repoId, number: prNumber },
    },
    select: { id: true, status: true, headSha: true, updatedAt: true },
  });

  if (existingPr && existingPr.status === "reviewing") {
    const stuckThresholdMs = 3 * 60 * 1000; // 3 minutes
    const isStuck = Date.now() - existingPr.updatedAt.getTime() > stuckThresholdMs;

    if (isStuck) {
      console.log(`[webhook] Review for PR #${prNumber} stuck for >3min, marking as failed and restarting`);
      await prisma.pullRequest.update({
        where: { id: existingPr.id },
        data: { status: "failed", errorMessage: "Review timed out after 3 minutes" },
      });
    } else if (existingPr.headSha === headSha) {
      console.log(`[webhook] Review already in progress for PR #${prNumber} (same SHA), skipping`);
      return;
    } else {
      console.log(`[webhook] New SHA detected for PR #${prNumber}, restarting review`);
    }
  }

  // Check if PR author is blocked from triggering reviews
  if (prAuthor) {
    const globalBlocked = (systemConfig?.blockedAuthors as string[]) ?? [];
    const orgBlocked = (org?.blockedAuthors as string[]) ?? [];
    const authorLower = prAuthor.toLowerCase();
    const isBlocked = [...globalBlocked, ...orgBlocked].some(
      (b) => b.toLowerCase() === authorLower,
    );
    if (isBlocked) {
      console.log(`[webhook] PR author "${prAuthor}" is blocked for org ${orgId}, skipping PR #${prNumber}`);
      return;
    }
  }

  // Upsert PullRequest record
  console.log(`[webhook] Upserting PullRequest — repo: ${repoId}, PR #${prNumber}, status: pending`);
  const pr = await prisma.pullRequest.upsert({
    where: {
      repositoryId_number: { repositoryId: repoId, number: prNumber },
    },
    create: {
      number: prNumber,
      title: prTitle,
      url: prUrl,
      author: prAuthor,
      headSha: headSha || null,
      status: "pending",
      triggerCommentId,
      triggerCommentBody,
      repositoryId: repoId,
    },
    update: {
      title: prTitle,
      url: prUrl,
      author: prAuthor,
      headSha: headSha || null,
      status: "pending",
      triggerCommentId,
      triggerCommentBody,
      reviewBody: null,
      errorMessage: null,
    },
  });
  console.log(`[webhook] PullRequest upserted — id: ${pr.id}, number: ${pr.number}`);

  const existingCommentId = pr.reviewCommentId ? Number(pr.reviewCommentId) : null;
  const placeholderBody =
    "> 🐙 **Octopus Review** is analyzing this pull request...\n>\n> This comment will be updated with the full review once complete.";

  // Post or update placeholder comment
  try {
    if (existingCommentId) {
      console.log(`[webhook] Updating existing placeholder comment — commentId: ${existingCommentId}`);
      if (provider === "github" && installationId) {
        await github.updatePullRequestComment(installationId, owner, repoName, existingCommentId, placeholderBody);
      } else if (provider === "bitbucket" && organizationId) {
        await bitbucket.updatePullRequestComment(organizationId, owner, repoName, prNumber, existingCommentId, placeholderBody);
      }
    } else {
      console.log(`[webhook] Posting new placeholder comment to PR #${prNumber}`);
      let newCommentId: number;
      if (provider === "github" && installationId) {
        newCommentId = await github.createPullRequestComment(installationId, owner, repoName, prNumber, placeholderBody);
      } else if (provider === "bitbucket" && organizationId) {
        newCommentId = await bitbucket.createPullRequestComment(organizationId, owner, repoName, prNumber, placeholderBody);
      } else {
        throw new Error("Invalid provider configuration");
      }
      console.log(`[webhook] Placeholder comment posted — commentId: ${newCommentId}`);
      await prisma.pullRequest.update({
        where: { id: pr.id },
        data: { reviewCommentId: newCommentId },
      });
    }
  } catch (err) {
    console.error("[webhook] Failed to post/update placeholder comment:", err);
  }

  // Notify real-time dashboard
  const channel = `presence-org-${orgId}`;
  pubby
    .trigger(channel, "review-requested", {
      repoId,
      pullRequest: {
        id: pr.id,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        author: pr.author,
        status: pr.status,
      },
    })
    .catch((err) => console.error("[webhook] Pubby trigger failed:", err));

  eventBus.emit({
    type: "review-requested",
    orgId,
    prNumber,
    prTitle,
    prAuthor,
    prUrl,
  });

  // Fire-and-forget: start the review process
  processReview(pr.id).catch((err) =>
    console.error("[webhook] Review failed:", err),
  );
}
