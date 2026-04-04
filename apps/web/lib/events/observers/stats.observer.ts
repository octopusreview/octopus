import { prisma } from "@octopus/db";
import { pubby } from "@/lib/pubby";
import { eventBus } from "../bus";
import type {
  ReviewCompletedEvent,
  RepoIndexedEvent,
  KnowledgeReadyEvent,
} from "../types";

async function getStats() {
  const [chunkAgg, knowledgeChunkAgg, findings, reviews, repositories] =
    await Promise.all([
      prisma.repository.aggregate({
        _sum: { totalChunks: true },
      }),
      prisma.knowledgeDocument.aggregate({
        _sum: { totalChunks: true },
        where: { deletedAt: null, status: "ready" },
      }),
      prisma.reviewIssue.count(),
      prisma.pullRequest.count({
        where: { status: "completed" },
      }),
      prisma.repository.count({ where: { isActive: true } }),
    ]);

  return {
    chunks:
      (chunkAgg._sum.totalChunks ?? 0) +
      (knowledgeChunkAgg._sum.totalChunks ?? 0),
    findings,
    reviews,
    repositories,
  };
}

async function broadcastStats() {
  try {
    const stats = await getStats();
    await pubby.trigger("landing-stats", "stats:updated", stats);
  } catch (err) {
    console.error("[stats-observer] Failed to broadcast stats:", err);
  }
}

function onReviewCompleted(_event: ReviewCompletedEvent) {
  broadcastStats();
}

function onRepoIndexed(event: RepoIndexedEvent) {
  if (event.success) broadcastStats();
}

function onKnowledgeReady(_event: KnowledgeReadyEvent) {
  broadcastStats();
}

export function registerStatsObserver(): void {
  console.log("[stats-observer] Registering Stats observer");

  eventBus.on<ReviewCompletedEvent>("review-completed", onReviewCompleted);
  eventBus.on<RepoIndexedEvent>("repo-indexed", onRepoIndexed);
  eventBus.on<KnowledgeReadyEvent>("knowledge-ready", onKnowledgeReady);
}
