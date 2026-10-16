import "server-only";
import { recordReviewAdmissionAfterCommit } from "./review-attempt-outcome";
import { prisma, Prisma, type PullRequest } from "@octopus/db";
import * as github from "@/lib/github";
import * as bitbucket from "@/lib/bitbucket";
import * as gitlab from "@/lib/gitlab";
import * as forgejo from "@/lib/forgejo";

export type ReviewRequestParams = {
  provider: "github" | "bitbucket" | "gitlab" | "forgejo";
  installationId?: number;
  organizationId?: string;
  repoFullName: string;
  repoId: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  prAuthor: string;
  headSha: string | null;
  automatic?: boolean;
  triggerCommentId: number | bigint | null;
  triggerCommentBody: string | null;
};

export type ReviewRequestRejection = {
  started: false;
  reason: "already_reviewed" | "stale_head" | "head_unavailable" | "already_in_progress" | "request_contended";
  message: string;
};

type AdmissionResult = { started: true; pullRequest: PullRequest } | ReviewRequestRejection;

async function currentProviderHead(params: ReviewRequestParams): Promise<string | null> {
  const [owner, repo] = params.repoFullName.split("/");
  let details;
  if (params.provider === "github" && params.installationId) {
    details = await github.getPullRequestDetails(params.installationId, owner, repo, params.prNumber);
  } else if (params.provider === "bitbucket" && params.organizationId) {
    details = await bitbucket.getPullRequestDetails(params.organizationId, owner, repo, params.prNumber);
  } else if (params.provider === "gitlab" && params.organizationId) {
    details = await gitlab.getPullRequestDetails(params.organizationId, params.repoFullName, params.prNumber);
  } else if (params.provider === "forgejo" && params.organizationId) {
    details = await forgejo.getPullRequestDetails(params.organizationId, params.repoFullName, params.prNumber);
  } else {
    throw new Error("Invalid provider configuration");
  }
  return details.headSha || null;
}

/** Validate provider head before atomically replacing the current request. */
export async function admitReviewRequest(params: ReviewRequestParams, client: Prisma.TransactionClient = prisma): Promise<AdmissionResult> {
  const admission = await (params.provider === "forgejo"
    ? forgejo.runWithForgejoRepository(params.repoId, () => admitReviewRequestInternal(params, client))
    : admitReviewRequestInternal(params, client));
  if (admission.started && client === prisma) {
    recordReviewAdmissionAfterCommit(admission.pullRequest.id, admission.pullRequest.reviewRequestVersion);
  }
  return admission;
}

async function admitReviewRequestInternal(params: ReviewRequestParams, client: Prisma.TransactionClient): Promise<AdmissionResult> {
  const automatic = params.provider === "forgejo" && params.automatic === true;
  const where = { repositoryId_number: { repositoryId: params.repoId, number: params.prNumber } };
  for (let attempt = 0; attempt < 3; attempt++) {
    // Capture the DB state before the remote read. A competing request that
    // wins while that read is in flight must force a fresh provider read.
    const existing = await client.pullRequest.findUnique({
      where,
      select: { id: true, status: true, headSha: true, reviewRequestVersion: true, updatedAt: true },
    });
    const headSha = await currentProviderHead(params);
    if (!headSha) {
      return { started: false, reason: "head_unavailable", message: "The provider did not return a current pull request head" };
    }
    if (params.headSha && params.headSha !== headSha) {
      return { started: false, reason: "stale_head", message: `PR #${params.prNumber} has moved to a different head` };
    }
    if (automatic && existing && ((existing.headSha === headSha && existing.status === "completed")
      || await client.reviewAttempt.findFirst({ where: { pullRequestId: existing.id, headSha }, select: { id: true } }))) {
      return { started: false, reason: "already_reviewed", message: `PR #${params.prNumber} has already been reviewed at this head` };
    }
    if (existing && existing.headSha === headSha
      && ["reviewing", "pending", "queued"].includes(existing.status)
      && (automatic || Date.now() - existing.updatedAt.getTime() <= 3 * 60 * 1000)) {
      return { started: false, reason: "already_in_progress", message: `Review already in progress for PR #${params.prNumber}` };
    }

    const data = {
      title: params.prTitle,
      url: params.prUrl,
      author: params.prAuthor,
      headSha,
      status: "pending",
      triggerCommentId: params.triggerCommentId,
      triggerCommentBody: params.triggerCommentBody,
    };
    if (!existing) {
      try {
        const pullRequest = await client.pullRequest.create({ data: {
          ...data, repositoryId: params.repoId, number: params.prNumber, reviewRequestVersion: 1,
        } });
        return { started: true, pullRequest };
      } catch (error) {
        // A concurrent first request created the unique repository/PR row.
        if (error && typeof error === "object" && "code" in error && error.code === "P2002") continue;
        throw error;
      }
    }

    // UPDATE ... RETURNING keeps the accepted snapshot and its version
    // together. Forgejo callers also wrap admission and enqueue in a transaction.
    const [pullRequest] = await client.pullRequest.updateManyAndReturn({
      where: {
        id: existing.id, headSha: existing.headSha, reviewRequestVersion: existing.reviewRequestVersion,
        status: existing.status, updatedAt: existing.updatedAt,
        ...(automatic ? { reviewAttempts: { none: { headSha } } } : {}),
      },
      data: {
        ...data, reviewRequestVersion: { increment: 1 }, reviewBody: null,
        reviewCoverage: Prisma.DbNull, errorMessage: null,
      },
    });
    if (pullRequest) return { started: true, pullRequest };
  }
  return { started: false, reason: "request_contended", message: "The review request changed during admission; retry the request" };
}
