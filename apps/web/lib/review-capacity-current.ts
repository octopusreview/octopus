import "server-only";
import { prisma } from "@octopus/db";
import { getOrgSpendLimitStatus, shouldGuardConcurrency } from "./cost";
import type { AiProvider } from "./providers";

/** Recheck the current claim and remote revisions without re-resolving the admitted model. */
export async function confirmCompleteReviewCurrent(input: {
  pullRequestId: string; orgId: string; repoId: string; model: string;
  headSha: string; baseSha: string; reviewRequestVersion: number;
  fetchRevision: (signal: AbortSignal) => Promise<{ headSha: string; baseSha: string | null }>;
  provider?: AiProvider;
}, signal: AbortSignal): Promise<"stale-review" | "billing-blocked" | null> {
  signal.throwIfAborted();
  // A remote fetch can consume most of the preflight window. Read the claim after it finishes.
  const details = await input.fetchRevision(signal);
  signal.throwIfAborted();
  if (details.headSha !== input.headSha || details.baseSha !== input.baseSha) return "stale-review";
  const spend = await getOrgSpendLimitStatus(input.orgId, input.repoId, { model: input.model, provider: input.provider ?? "anthropic" });
  signal.throwIfAborted();
  const current = await prisma.pullRequest.findFirst({ where: { id: input.pullRequestId, status: "reviewing", headSha: input.headSha,
    reviewRequestVersion: input.reviewRequestVersion },
    select: { id: true, repository: { select: { organization: { select: { reviewsPaused: true } } } } } });
  signal.throwIfAborted();
  if (!current || current.repository.organization.reviewsPaused) return "stale-review";
  return spend.blocked ? "billing-blocked" : null;
}

/** Before a generation retry: the same checks, plus organization access and the low-balance one-at-a-time guard. */
export async function confirmGenerationRetryCurrent(input: Parameters<typeof confirmCompleteReviewCurrent>[0] & { provider: AiProvider }, signal: AbortSignal): Promise<"stale-review" | "billing-blocked" | "access-lost" | null> {
  const reason = await confirmCompleteReviewCurrent(input, signal);
  if (reason) return reason;
  const access = await prisma.repository.findFirst({ where: { id: input.repoId, isActive: true,
    organization: { id: input.orgId, bannedAt: null, deletedAt: null } }, select: { id: true } });
  signal.throwIfAborted();
  if (!access) return "access-lost";
  const guarded = await shouldGuardConcurrency(input.orgId) && await prisma.pullRequest.count({ where: {
    repository: { organizationId: input.orgId }, status: "reviewing", id: { not: input.pullRequestId } } }) > 0;
  signal.throwIfAborted();
  return guarded ? "billing-blocked" : null;
}
