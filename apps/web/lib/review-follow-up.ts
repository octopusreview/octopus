import "server-only";
import { prisma } from "@octopus/db";
import type { ReviewCoverage } from "@/lib/review-coverage";
import { isReviewRequestVersion } from "@/lib/review-status-state";

/** An unfinished first assessment must not inherit follow-up finding limits. */
export async function canRestrictReviewToFollowUp(pullRequestId: string, current: ReviewCoverage): Promise<boolean> {
  if (!current.complete || !current.baseSha || !isReviewRequestVersion(current.reviewRequestVersion)
    || current.reviewRequestVersion === 0) return false;

  try {
    // Admission clears the mutable PR result. Read the latest immutable attempt
    // through the existing PR/time index; never search back for an older pass.
    const latest = await prisma.reviewAttempt.findFirst({
      where: { pullRequestId }, orderBy: { createdAt: "desc" }, select: { coverage: true },
    });
    const prior = latest?.coverage as ReviewCoverage | null;
    const assessment = prior?.assessment;
    if (prior?.version !== 1 || prior.complete !== true || prior.inventoryComplete !== true || assessment?.state !== "completed"
      || prior.reviewRequestVersion !== current.reviewRequestVersion - 1
      || !prior.headSha || prior.baseSha !== current.baseSha || !Array.isArray(prior.files)
      || prior.expectedFiles !== prior.files.length
      || prior.files.some(file => !file || (file.state !== "supplied" && file.state !== "excluded"))) return false;
    if (assessment.completion?.state !== "completed" || !Array.isArray(assessment.requests) || assessment.requests.length !== 1
      || assessment.requests[0]?.inputPreserved !== true || !assessment.model || assessment.requests[0].model !== assessment.model
      || !assessment.requests[0].provider
      || ![assessment.requests[0].sha256, assessment.responseSha256, assessment.policySha256, assessment.templateSha256]
        .every(hash => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash))) return false;

    // A policy change can make a previously excluded file eligible. It needs a
    // first assessment even when the old attempt was complete under its policy.
    const supplied = new Set(prior.files.filter(file => file?.state === "supplied").map(file => file.path));
    return current.files.every(file => file.state === "excluded" || supplied.has(file.path));
  } catch (error) {
    console.warn("[reviewer] Prior assessment unavailable; performing a full review:", error);
    return false;
  }
}
