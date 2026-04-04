import { pubby } from "@/lib/pubby";
import { getLandingStats } from "@/lib/landing-stats";
import { eventBus } from "../bus";
import type {
  ReviewCompletedEvent,
  RepoIndexedEvent,
  KnowledgeReadyEvent,
} from "../types";

let lastBroadcast = 0;
const THROTTLE_MS = 10_000;

async function broadcastStats() {
  const now = Date.now();
  if (now - lastBroadcast < THROTTLE_MS) return;
  lastBroadcast = now;
  try {
    const stats = await getLandingStats();
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
  eventBus.on<ReviewCompletedEvent>("review-completed", onReviewCompleted);
  eventBus.on<RepoIndexedEvent>("repo-indexed", onRepoIndexed);
  eventBus.on<KnowledgeReadyEvent>("knowledge-ready", onKnowledgeReady);
}
