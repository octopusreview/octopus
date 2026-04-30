import { prisma } from "@octopus/db";
import { pubby } from "@/lib/pubby";
import {
  createPullRequestComment as ghCreatePullRequestComment,
  updatePullRequestComment as ghUpdatePullRequestComment,
  createPullRequestReview as ghCreatePullRequestReview,
  updateCheckRun as ghUpdateCheckRun,
} from "@/lib/github";
import { parseFindings } from "@/lib/review-dedup";
import {
  buildLowSeveritySummary,
  stripDetailedFindings,
  countFindings,
} from "@/lib/review-helpers";
import { eventBus } from "@/lib/events";

export type LargeReviewResultJob = {
  pullRequestId: string;
  reviewBody: string;
  durationMs?: number;
  error?: string;
};

const SEVERITY_TO_DB: Record<string, string> = {
  "🔴": "critical",
  "🟠": "high",
  "🟡": "medium",
  "🔵": "low",
  "💡": "low",
};

export async function handleLargeReviewResult(
  data: LargeReviewResultJob,
): Promise<void> {
  const pr = await prisma.pullRequest.findUnique({
    where: { id: data.pullRequestId },
    include: {
      repository: { include: { organization: true } },
    },
  });

  if (!pr) {
    console.error(
      `[large-review-result] PullRequest not found: ${data.pullRequestId}`,
    );
    return;
  }

  const repo = pr.repository;
  const org = repo.organization;
  const installationId = repo.installationId ?? org.githubInstallationId;
  const [owner, repoName] = repo.fullName.split("/");
  const isGitHub = repo.provider === "github";

  if (!isGitHub || !installationId) {
    console.error(
      `[large-review-result] Only GitHub is supported for large reviews — repo ${repo.id} provider=${repo.provider}`,
    );
    return;
  }

  const reviewCommentId = pr.reviewCommentId ? Number(pr.reviewCommentId) : null;

  if (data.error) {
    const errorBody = [
      "> 🐙 **Octopus Review** encountered an error while analyzing this large pull request.",
      ">",
      `> \`${data.error}\``,
      ">",
      "> Please try again by commenting `@octopus` on this PR.",
    ].join("\n");

    if (reviewCommentId) {
      await ghUpdatePullRequestComment(
        installationId,
        owner,
        repoName,
        reviewCommentId,
        errorBody,
      ).catch((e) =>
        console.error("[large-review-result] Failed to update placeholder:", e),
      );
    } else {
      await ghCreatePullRequestComment(
        installationId,
        owner,
        repoName,
        pr.number,
        errorBody,
      ).catch((e) =>
        console.error("[large-review-result] Failed to create error comment:", e),
      );
    }

    await prisma.pullRequest.update({
      where: { id: pr.id },
      data: { status: "failed", errorMessage: data.error },
    });

    eventBus.emit({
      type: "review-failed",
      orgId: org.id,
      prNumber: pr.number,
      prTitle: pr.title,
      error: data.error,
    });
    return;
  }

  const reviewBody = data.reviewBody;

  // 1. Parse findings out of the markdown
  const findings = parseFindings(reviewBody);
  const findingsCount = countFindings(reviewBody);
  console.log(
    `[large-review-result] PR #${pr.number}: ${reviewBody.length} chars, ${findings.length} findings parsed`,
  );

  // 2. Update placeholder comment with main body (findings JSON stripped — they go inline/summary)
  const mainCommentBody = stripDetailedFindings(reviewBody);
  let mainCommentId = reviewCommentId;
  if (mainCommentId) {
    try {
      await ghUpdatePullRequestComment(
        installationId,
        owner,
        repoName,
        mainCommentId,
        mainCommentBody,
      );
    } catch (err) {
      // Comment may have been deleted — recreate
      if (err instanceof Error && err.message.includes("404")) {
        const newId = await ghCreatePullRequestComment(
          installationId,
          owner,
          repoName,
          pr.number,
          mainCommentBody,
        );
        mainCommentId = newId;
        await prisma.pullRequest.update({
          where: { id: pr.id },
          data: { reviewCommentId: newId },
        });
      } else {
        throw err;
      }
    }
  } else {
    const newId = await ghCreatePullRequestComment(
      installationId,
      owner,
      repoName,
      pr.number,
      mainCommentBody,
    );
    mainCommentId = newId;
    await prisma.pullRequest.update({
      where: { id: pr.id },
      data: { reviewCommentId: newId },
    });
  }

  // 3. Post a summary review (no inline comments — internal-cli path doesn't compute
  // diff line maps. All findings end up in the summary table.)
  const hasCritical = findings.some((f) => f.severity === "🔴");
  const hasHigh = findings.some((f) => f.severity === "🟠");
  const hasMedium = findings.some((f) => f.severity === "🟡");
  const threshold = org.checkFailureThreshold || "critical";
  const shouldRequestChanges =
    threshold !== "none" &&
    (hasCritical ||
      (threshold !== "critical" && hasHigh) ||
      (threshold === "medium" && hasMedium));
  const reviewEvent: "COMMENT" | "REQUEST_CHANGES" = shouldRequestChanges
    ? "REQUEST_CHANGES"
    : "COMMENT";

  const findingsBlock = buildLowSeveritySummary(findings);
  const summaryHeader = `Large PR — ${findings.length} finding${findings.length !== 1 ? "s" : ""}${
    mainCommentId && pr.url ? ` | [View details](${pr.url}#issuecomment-${mainCommentId})` : ""
  }`;
  const summaryBody = [
    summaryHeader,
    findingsBlock,
    `<sub>Reviewed by [Octopus Review](https://octopus-review.ai) (large-PR pipeline, no inline comments).</sub>`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    await ghCreatePullRequestReview(
      installationId,
      owner,
      repoName,
      pr.number,
      summaryBody,
      reviewEvent,
      [],
    );
    console.log(
      `[large-review-result] PR review submitted (${reviewEvent}, ${findings.length} findings in summary)`,
    );
  } catch (err) {
    console.error(
      "[large-review-result] Failed to submit review, falling back to comment:",
      err,
    );
    await ghCreatePullRequestComment(
      installationId,
      owner,
      repoName,
      pr.number,
      summaryBody,
    );
  }

  // 4. Persist findings to review_issues
  await prisma.reviewIssue.deleteMany({ where: { pullRequestId: pr.id } });
  if (findings.length > 0) {
    await prisma.reviewIssue.createMany({
      data: findings.map((f) => ({
        title: f.title.replace(/^(CRITICAL|HIGH|MEDIUM|LOW|INFO)\s*—\s*/i, "").trim(),
        description: f.description || f.category,
        severity: SEVERITY_TO_DB[f.severity] ?? "medium",
        filePath: f.filePath || null,
        lineNumber: f.startLine || null,
        confidence: f.confidence ? String(f.confidence) : null,
        pullRequestId: pr.id,
      })),
    });
    console.log(`[large-review-result] Saved ${findings.length} review issues to DB`);
  }

  // 5. Mark PR completed
  await prisma.pullRequest.update({
    where: { id: pr.id },
    data: { status: "completed", reviewBody, errorMessage: null },
  });

  // 6. Update check run if PR has headSha (best effort — we don't track checkRunId
  // across the queue boundary, so we recreate-or-skip via a fresh check run.)
  if (pr.headSha) {
    try {
      const conclusion = shouldRequestChanges ? "failure" : "success";
      const summaryText = shouldRequestChanges
        ? hasCritical
          ? "Critical issues found that must be fixed before merge."
          : hasHigh
            ? "High severity issues found that should be fixed before merge."
            : "Medium severity issues found that should be fixed before merge."
        : findings.length > 0
          ? "Review complete. No issues above the configured threshold."
          : "Review complete. No issues found.";

      const { createCheckRun: ghCreateCheckRun } = await import("@/lib/github");
      const checkRunId = await ghCreateCheckRun(
        installationId,
        owner,
        repoName,
        pr.headSha,
        "Octopus Review (Large PR)",
      );
      await ghUpdateCheckRun(
        installationId,
        owner,
        repoName,
        checkRunId,
        conclusion,
        {
          title: `${findings.length} finding${findings.length !== 1 ? "s" : ""}`,
          summary: summaryText,
        },
      );
    } catch (err) {
      console.error("[large-review-result] Check run update failed:", err);
    }
  }

  // 7. Pubby + event bus
  await pubby
    .trigger(`presence-org-${org.id}`, "review-status", {
      repoId: repo.id,
      pullRequestId: pr.id,
      number: pr.number,
      status: "completed",
      step: "completed",
    })
    .catch((e) =>
      console.error("[large-review-result] Pubby trigger failed:", e),
    );

  eventBus.emit({
    type: "review-completed",
    orgId: org.id,
    prNumber: pr.number,
    prTitle: pr.title,
    prUrl: pr.url,
    findingsCount,
    filesChanged: 0, // not known on this path; could be passed from internal-cli later
  });

  console.log(
    `[large-review-result] Completed PR #${pr.number} (duration ${data.durationMs ?? "?"}ms)`,
  );
}
