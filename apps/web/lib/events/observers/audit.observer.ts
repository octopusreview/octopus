import { writeAuditLog } from "@/lib/audit";
import { eventBus } from "../bus";
import type {
  RepoIndexedEvent,
  RepoAnalyzedEvent,
  ReviewRequestedEvent,
  ReviewCompletedEvent,
  ReviewFailedEvent,
  KnowledgeReadyEvent,
} from "../types";

function onRepoIndexed(event: RepoIndexedEvent): Promise<void> {
  return writeAuditLog({
    action: event.success ? "repo.indexed" : "repo.index_failed",
    category: "repo",
    organizationId: event.orgId,
    targetType: "repository",
    metadata: {
      repoFullName: event.repoFullName,
      success: event.success,
      indexedFiles: event.indexedFiles,
      totalVectors: event.totalVectors,
      durationMs: event.durationMs,
      error: event.error,
    },
  });
}

function onRepoAnalyzed(event: RepoAnalyzedEvent): Promise<void> {
  return writeAuditLog({
    action: "repo.analyzed",
    category: "repo",
    organizationId: event.orgId,
    targetType: "repository",
    metadata: { repoFullName: event.repoFullName },
  });
}

function onReviewRequested(event: ReviewRequestedEvent): Promise<void> {
  return writeAuditLog({
    action: "review.requested",
    category: "review",
    organizationId: event.orgId,
    targetType: "pr",
    metadata: {
      prNumber: event.prNumber,
      prTitle: event.prTitle,
      prAuthor: event.prAuthor,
      prUrl: event.prUrl,
    },
  });
}

function onReviewCompleted(event: ReviewCompletedEvent): Promise<void> {
  return writeAuditLog({
    action: "review.completed",
    category: "review",
    organizationId: event.orgId,
    targetType: "pr",
    metadata: {
      prNumber: event.prNumber,
      prTitle: event.prTitle,
      prUrl: event.prUrl,
      findingsCount: event.findingsCount,
      filesChanged: event.filesChanged,
    },
  });
}

function onReviewFailed(event: ReviewFailedEvent): Promise<void> {
  return writeAuditLog({
    action: "review.failed",
    category: "review",
    organizationId: event.orgId,
    targetType: "pr",
    metadata: {
      prNumber: event.prNumber,
      prTitle: event.prTitle,
      error: event.error,
    },
  });
}

function onKnowledgeReady(event: KnowledgeReadyEvent): Promise<void> {
  return writeAuditLog({
    action: `knowledge.${event.action}`,
    category: "knowledge",
    organizationId: event.orgId,
    targetType: "knowledge_document",
    metadata: {
      documentTitle: event.documentTitle,
      action: event.action,
      totalChunks: event.totalChunks,
      totalVectors: event.totalVectors,
    },
  });
}

export function registerAuditObserver(): void {
  console.log("[audit-observer] Registering Audit observer");

  eventBus.on<RepoIndexedEvent>("repo-indexed", onRepoIndexed);
  eventBus.on<RepoAnalyzedEvent>("repo-analyzed", onRepoAnalyzed);
  eventBus.on<ReviewRequestedEvent>("review-requested", onReviewRequested);
  eventBus.on<ReviewCompletedEvent>("review-completed", onReviewCompleted);
  eventBus.on<ReviewFailedEvent>("review-failed", onReviewFailed);
  eventBus.on<KnowledgeReadyEvent>("knowledge-ready", onKnowledgeReady);
}
