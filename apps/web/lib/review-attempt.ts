import "server-only";
import { isReviewRequestVersion } from "@/lib/review-status-state";
import { isDeepStrictEqual } from "node:util";
import { prisma, type Prisma } from "@octopus/db";
import { withForgejoPublication } from "@/lib/forgejo-connector";
import { applyReviewCoverage, unknownReviewCoverage, type ReviewCoverage } from "@/lib/review-coverage";

export async function updateCurrentReview(pullRequestId: string, headSha: string | null, reviewRequestVersion: number | undefined, data: Prisma.PullRequestUpdateManyMutationInput, expectedReviewBody?: string) {
  if (!headSha || !isReviewRequestVersion(reviewRequestVersion)) return { count: 0 };
  return prisma.pullRequest.updateMany({ where: { id: pullRequestId, headSha, reviewRequestVersion, ...(expectedReviewBody !== undefined ? { reviewBody: expectedReviewBody } : {}) }, data });
}

/** Call only after the final report has been published successfully. Never infer this from an archived result. */
export async function recordFirstReviewCompletion(pullRequestId: string, headSha: string | null, reviewRequestVersion: number | undefined, reviewBody: string) {
  if (!headSha || !isReviewRequestVersion(reviewRequestVersion)) return;
  await prisma.pullRequest.updateMany({
    where: { id: pullRequestId, headSha, reviewRequestVersion, reviewBody, status: "completed", firstReviewCompletedAt: null },
    data: { firstReviewCompletedAt: new Date() },
  });
}

export async function createReviewAttemptComment(
  pullRequestId: string,
  headSha: string | null,
  reviewRequestVersion: number | undefined,
  create: () => Promise<number>,
  expectedReviewBody?: string,
): Promise<number> {
  let saved = false;
  return withForgejoPublication(async () => {
    const id = await create();
    const updated = await updateCurrentReview(pullRequestId, headSha, reviewRequestVersion, { reviewCommentId: id }, expectedReviewBody);
    saved = updated.count === 1;
    return id;
  }, { key: JSON.stringify([pullRequestId, headSha, reviewRequestVersion]), acknowledged: async () => saved });
}

export function withForgejoReviewPublication(
  pullRequestId: string, headSha: string | null, reviewRequestVersion: number,
  review: () => Promise<void>, signal?: AbortSignal,
): Promise<void> {
  return withForgejoPublication(review, {
    key: JSON.stringify([pullRequestId, headSha, reviewRequestVersion]), signal,
    acknowledged: async tx => (await tx.pullRequest.count({ where: {
      id: pullRequestId, headSha, reviewRequestVersion, status: { in: ["completed", "failed"] },
    } })) === 1,
  });
}

/**
 * Record an attempt whose worker stopped before it archived anything, under the attempt's own ID.
 * It is inserted directly: saveReviewAttempt would promote it to the current report. Repeating it changes nothing.
 */
export async function recordInterruptedAttempt(pr: { id: string; reviewAttemptId: string | null; headSha: string | null; reviewRequestVersion: number; repository: { provider: string } }): Promise<void> {
  if (!pr.reviewAttemptId) return;
  const coverage = unknownReviewCoverage(pr.repository.provider, "Worker stopped before this attempt was recorded");
  coverage.headSha = pr.headSha;
  coverage.reviewRequestVersion = pr.reviewRequestVersion;
  const budget = await prisma.reviewAttemptOutcome.findUnique({
    where: { pullRequestId_requestVersion: { pullRequestId: pr.id, requestVersion: pr.reviewRequestVersion } }, select: { generationAttempts: true },
  });
  // A generation was dispatched and no charge for this request exists: the provider may or may not have completed it.
  if (budget?.generationAttempts && !await prisma.aiUsage.count({ where: { chargeKey: `review-generation:${pr.id}:${pr.reviewRequestVersion}:${pr.headSha}` } })) {
    coverage.limitations.push("provider dispatch outcome unknown");
  }
  await prisma.reviewAttempt.createMany({ skipDuplicates: true, data: [{
    id: pr.reviewAttemptId, pullRequestId: pr.id, headSha: pr.headSha, baseSha: null,
    coverage: JSON.parse(JSON.stringify(coverage)) as Prisma.InputJsonValue,
    reviewBody: applyReviewCoverage("## 🐙 Octopus Review\n\nWorker stopped before this attempt was recorded.", coverage, pr.reviewAttemptId),
  }] });
}

export async function hasReviewAttempt(attemptId: string, pullRequestId: string, coverage: ReviewCoverage, reviewBody: string, client: Pick<Prisma.TransactionClient, "reviewAttempt"> = prisma, failureFingerprint: string | null = null) {
  const existing = await client.reviewAttempt.findUnique({ where: { id: attemptId } });
  if (!existing) return false;
  if (existing.pullRequestId !== pullRequestId || existing.headSha !== coverage.headSha || existing.baseSha !== coverage.baseSha
    || existing.reviewBody !== reviewBody || (existing.failureFingerprint ?? null) !== failureFingerprint || !isDeepStrictEqual(existing.coverage, JSON.parse(JSON.stringify(coverage)))) {
    throw new Error("Review attempt identity conflict");
  }
  return true;
}

/** Store a new immutable result and the current PR view atomically. */
export async function saveReviewAttempt(
  attemptId: string,
  pullRequestId: string,
  coverage: ReviewCoverage,
  reviewBody: string,
  issues?: Prisma.ReviewIssueCreateManyInput[],
  failureFingerprint: string | null = null,
) {
  const coverageJson = JSON.parse(JSON.stringify(coverage)) as Prisma.InputJsonValue;
  return prisma.$transaction(async tx => {
    const inserted = await tx.reviewAttempt.createMany({ skipDuplicates: true, data: [{
      id: attemptId, pullRequestId, headSha: coverage.headSha,
      baseSha: coverage.baseSha, coverage: coverageJson, reviewBody, failureFingerprint,
    }] });
    if (!inserted.count) {
      if (!await hasReviewAttempt(attemptId, pullRequestId, coverage, reviewBody, tx, failureFingerprint)) throw new Error("Review attempt identity conflict");
      return false;
    }
    if (!coverage.headSha || !isReviewRequestVersion(coverage.reviewRequestVersion)) return false;
    const promoted = await tx.pullRequest.updateMany({ where: { id: pullRequestId, headSha: coverage.headSha, reviewRequestVersion: coverage.reviewRequestVersion }, data: {
      status: "completed", reviewBody, reviewCoverage: coverageJson, errorMessage: null,
    } });
    if (!promoted.count) return false;
    if (issues !== undefined) {
      await tx.reviewIssue.deleteMany({ where: { pullRequestId } });
      if (issues.length) await tx.reviewIssue.createMany({ data: issues });
    }
    return true;
  });
}
