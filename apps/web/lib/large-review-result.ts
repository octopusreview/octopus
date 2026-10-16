import "server-only";
import { ReviewOutcomeRecorder, startReviewOutcome } from "@/lib/review-attempt-outcome";
import { isReviewRequestVersion } from "@/lib/review-status-state";
import { randomUUID } from "node:crypto";
import { deliverReviewAttempt } from "@/lib/review-attempt-delivery";
import { saveReviewAttempt, updateCurrentReview, hasReviewAttempt, recordFirstReviewCompletion } from "@/lib/review-attempt";
import { publishReviewSummary } from "@/lib/review-summary-comment";
import { unknownReviewCoverage, applyReviewCoverage, coverageSummary, reviewCheckResult } from "@/lib/review-coverage";
import { prisma, type Prisma } from "@octopus/db";
import { pubby } from "@/lib/pubby";
import {
  createPullRequestReview as ghCreatePullRequestReview,
  updateCheckRun as ghUpdateCheckRun,
} from "@/lib/github";
import { parseFindings } from "@/lib/review-dedup";
import { findingSignature, mergeFindingsBySignature, inheritReviewIssueTriage } from "@/lib/finding-merge";
import {
  buildLowSeveritySummary,
  normalizeLastReviewedCommit,
  stripDetailedFindings,
  filterByConfidence,
  resolveConfidenceThreshold,
  sortAndCapFindings,
  parseReviewConfig,
  mergeReviewConfigs,
  MAX_FINDINGS_PER_REVIEW,
  shouldFailReviewCheck,
  type ReviewConfig,
} from "@/lib/review-helpers";
import { eventBus } from "@/lib/events";

export type LargeReviewResultJob = {
  pullRequestId: string;
  attemptId?: string;
  reviewRequestVersion?: number;
  headSha?: string | null;
  baseSha?: string | null;
  checkRunId?: number | null;
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

  const correlated = typeof data.attemptId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.attemptId)
    && typeof data.headSha === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(data.headSha)
    && typeof data.baseSha === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(data.baseSha);
  const attemptId = correlated ? data.attemptId! : randomUUID();
  const coverage = unknownReviewCoverage(repo.provider, "Large-review worker did not supply verified changed-file coverage.");
  if (correlated) {
    if (isReviewRequestVersion(data.reviewRequestVersion)) coverage.reviewRequestVersion = data.reviewRequestVersion;
    coverage.headSha = data.headSha!;
    coverage.baseSha = data.baseSha!;
    if (Number.isSafeInteger(data.checkRunId) && data.checkRunId! > 0) coverage.nativeCheckId = String(data.checkRunId);
  }
  const reviewBody = applyReviewCoverage(data.error ? `Large review failed: ${data.error}` : data.reviewBody, coverage, attemptId);
  const outcomeKey = { organizationId: org.id, repositoryId: repo.id, pullRequestId: pr.id,
    requestVersion: data.reviewRequestVersion ?? -1 };
  const outcomeRecord = new ReviewOutcomeRecorder(outcomeKey, true);
  const recordOutcome = correlated && Number.isInteger(data.reviewRequestVersion) && data.reviewRequestVersion! > 0;
  if (recordOutcome) await startReviewOutcome(outcomeKey, new Date());
  try {
  await hasReviewAttempt(attemptId, pr.id, coverage, reviewBody);
  // 1. Parse findings out of the markdown, then apply the SAME per-category
  // confidence filter + severity cap as the standard path (#652) so the largest,
  // most bug-prone PRs no longer get raw model output straight to comments.
  // (Diff-dependent validateFindings + semantic suppression require the diff,
  // which this job payload doesn't carry — tracked as a follow-up.)
  // Resolve the repo/org-configured threshold + max via the same 3-tier merge as
  // the standard path so the two never diverge on configuration.
  let systemConfig: ReviewConfig = {};
  try {
    const sysRow = await prisma.systemConfig.findUnique({ where: { id: "singleton" } });
    if (sysRow) systemConfig = parseReviewConfig(sysRow.defaultReviewConfig);
  } catch {
    // SystemConfig unavailable — fall back to org/repo config only.
  }
  const reviewConfig = mergeReviewConfigs(
    systemConfig,
    parseReviewConfig(org.defaultReviewConfig),
    parseReviewConfig(repo.reviewConfig),
  );
  const parsedFindings = parseFindings(reviewBody);
  const { kept: findings, truncatedCount } = sortAndCapFindings(
    filterByConfidence(parsedFindings, resolveConfidenceThreshold(reviewConfig)),
    reviewConfig.maxFindings ?? MAX_FINDINGS_PER_REVIEW,
  );
  const findingsCount = findings.length;
  console.log(
    `[large-review-result] PR #${pr.number}: ${reviewBody.length} chars, ${parsedFindings.length} parsed → ${findings.length} after confidence filter${truncatedCount ? ` (capped ${truncatedCount})` : ""}`,
  );

  // 3. Post a summary review (no inline comments — internal-cli path doesn't compute
  // diff line maps. All findings end up in the summary table.)
  const hasCritical = findings.some((f) => f.severity === "🔴");
  const hasHigh = findings.some((f) => f.severity === "🟠");
  const hasMedium = findings.some((f) => f.severity === "🟡");
  const threshold = org.checkFailureThreshold || "critical";
  const shouldRequestChanges = shouldFailReviewCheck(
    { hasCritical, hasHigh, hasMedium },
    threshold,
  );
  const reviewEvent: "COMMENT" | "REQUEST_CHANGES" = shouldRequestChanges
    ? "REQUEST_CHANGES"
    : "COMMENT";

  // 4. Persist findings to review_issues
  // Signature-matched findings inherit prior triage state; delete+create run
  // atomically so a mid-way failure can never wipe triage without replacement.
  const priorIssues = await prisma.reviewIssue.findMany({ where: { pullRequestId: pr.id } });
  const current: Prisma.ReviewIssueCreateManyInput[] = findings.map((f) => {
    const title = f.title.replace(/^(CRITICAL|HIGH|MEDIUM|LOW|INFO)\s*—\s*/i, "").trim();
    return {
      title,
      description: f.description || f.category,
      severity: SEVERITY_TO_DB[f.severity] ?? "medium",
      filePath: f.filePath || null,
      lineNumber: f.startLine || null,
      confidence: f.confidence ? String(f.confidence) : null,
      pullRequestId: pr.id,
      signature: findingSignature({ filePath: f.filePath || "", category: f.category, title }),
    };
  });
  const { merged } = mergeFindingsBySignature<Prisma.ReviewIssueCreateManyInput>({
    prior: priorIssues,
    current,
    inherit: inheritReviewIssueTriage,
  });

  // The immutable result (and eligible current findings) must commit before
  // any final comment or native completion. Identical retries cannot promote
  // the same archive again or overwrite a replacement report.
  await saveReviewAttempt(attemptId, pr.id, coverage, reviewBody, data.error ? undefined : merged);
  outcomeRecord.assessment(coverage, attemptId);
  if (coverage.nativeCheckId) {
    const result = reviewCheckResult(coverage, false, 0);
    await ghUpdateCheckRun(installationId, owner, repoName, Number(coverage.nativeCheckId), result.conclusion, {
      title: result.title, summary: result.summary,
    });
  }
  const stillCurrent = async () => {
    if (!correlated || !isReviewRequestVersion(coverage.reviewRequestVersion)) return false;
    const latest = await prisma.pullRequest.findUnique({ where: { id: pr.id }, select: { headSha: true, reviewRequestVersion: true, reviewBody: true } });
    return latest?.headSha === coverage.headSha && latest.reviewRequestVersion === coverage.reviewRequestVersion && latest.reviewBody === reviewBody;
  };
  if (!await stillCurrent()) return;

  // Archive existence does not mean that remote delivery completed. Persist
  // checkpoints separately, so retries resume the unfinished publication.
  await deliverReviewAttempt(attemptId, async (progress, checkpoint) => {
    if (!await stillCurrent()) return;
    let mainCommentId: bigint | number | null = progress.mainCommentId;
    if (!mainCommentId) {
      const errorBody = [
        "> 🐙 **Octopus Review** encountered an error while analyzing this large pull request.",
        ">", `> \`${data.error}\``, ">",
        "> Please try again by commenting `@octopus-review` on this PR.",
      ].join("\n");
      const commentBody = data.error ? applyReviewCoverage(errorBody, coverage, attemptId) : stripDetailedFindings(reviewBody);
      const postMain = () => publishReviewSummary({ pullRequestId: pr.id, headSha: coverage.headSha,
        reviewRequestVersion: coverage.reviewRequestVersion, installationId, owner, repo: repoName,
        prNumber: pr.number, body: commentBody, expectedReviewBody: reviewBody,
        onPosted: !data.error && recordOutcome ? outcomeRecord.mainPosted : undefined });
      mainCommentId = !data.error && recordOutcome ? await outcomeRecord.publish(postMain) : await postMain();
      if (mainCommentId === null) return;
      await checkpoint({ mainCommentId });
    }
    if (!await stillCurrent()) return;
    if (data.error) {
      const failedUpdate = await updateCurrentReview(pr.id, coverage.headSha, coverage.reviewRequestVersion, { status: "failed", errorMessage: data.error }, reviewBody);
      if (failedUpdate.count) eventBus.emit({ type: "review-failed", orgId: org.id, prNumber: pr.number, prTitle: pr.title, error: data.error });
      return;
    }
    if (progress.mainCommentId && !data.error && recordOutcome) {
      outcomeRecord.mainPosted();
      await outcomeRecord.finish(new Date());
    }
    if (!progress.summaryPublished) {
      const findingsBlock = buildLowSeveritySummary(findings);
      const summaryHeader = `${coverageSummary(coverage)} Large PR — ${findings.length} finding${findings.length !== 1 ? "s" : ""}${
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
          undefined,
          coverage.headSha ?? undefined,
        );
        console.log(
          `[large-review-result] PR review submitted (${reviewEvent}, ${findings.length} findings in summary)`,
        );
      } catch (err) {
        console.error(
          "[large-review-result] Failed to submit review, falling back to comment:",
          err,
        );
        if (await publishReviewSummary({ pullRequestId: pr.id, headSha: coverage.headSha,
          reviewRequestVersion: coverage.reviewRequestVersion, installationId, owner, repo: repoName,
          prNumber: pr.number, body: normalizeLastReviewedCommit(`${stripDetailedFindings(reviewBody)}\n\n${summaryBody}`, coverage.headSha),
          expectedReviewBody: reviewBody }) === null) return;
      }
      await checkpoint({ summaryPublished: true });
    }
    if (!await stillCurrent()) return;
    // 7. Pubby + event bus
    await recordFirstReviewCompletion(pr.id, coverage.headSha, coverage.reviewRequestVersion, reviewBody);
    await pubby
      .trigger(`presence-org-${org.id}`, "review-status", {
        repoId: repo.id,
        pullRequestId: pr.id,
        headSha: coverage.headSha,
        reviewRequestVersion: coverage.reviewRequestVersion,
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
  });
  } finally {
    if (recordOutcome) await outcomeRecord.finish(new Date());
  }
}
