import { prisma, type Prisma } from "@octopus/db";
import { pubby, PUBBY_ENABLED } from "@/lib/pubby";
import { liveTelemetryActive } from "@/lib/entitlements";
import { projectActivity } from "@/lib/activity";
import { eventBus } from "../bus";
import type {
  AppEvent,
  RepoIndexedEvent,
  RepoAnalyzedEvent,
  ReviewRequestedEvent,
  ReviewCompletedEvent,
  ReviewFailedEvent,
  KnowledgeReadyEvent,
  CommunityReviewEvent,
} from "../types";

/**
 * Bridges internal AppEvents into the live activity feed: writes a privacy-safe
 * ActivityEvent row (always, for durable history + polling reconcile) and pushes
 * a throttled real-time event to the org's admin-only telemetry channel.
 *
 * The throttle is PER-ORG (the stats observer uses one global window). Every
 * event is still persisted; only the external Pubby fan-out is rate-limited, so
 * a dropped best-effort push self-heals when the dashboard polls the DB.
 */

const THROTTLE_MS = 5_000;
const lastBroadcast = new Map<string, number>();

const telemetryChannel = (orgId: string) => `private-telemetry-org-${orgId}`;

async function handle(event: AppEvent): Promise<void> {
  const orgId = (event as { orgId?: string }).orgId;
  if (!orgId) return;

  // Pure, cheap projection first — skips billing/admin events before any DB hit.
  const projected = projectActivity(event);
  if (!projected) return;

  // Only collect for orgs that are entitled AND have telemetry enabled.
  if (!(await liveTelemetryActive(orgId))) return;

  await prisma.activityEvent.create({
    data: {
      organizationId: orgId,
      actorType: projected.actorType,
      actorId: projected.actorId,
      actorLabel: projected.actorLabel,
      action: projected.action,
      target: projected.target,
      metadata: projected.metadata as Prisma.InputJsonValue,
    },
  });

  if (PUBBY_ENABLED) {
    const now = Date.now();
    if (now - (lastBroadcast.get(orgId) ?? 0) >= THROTTLE_MS) {
      lastBroadcast.set(orgId, now);
      pubby
        .trigger(telemetryChannel(orgId), "activity", {
          action: projected.action,
          target: projected.target,
          actorType: projected.actorType,
          actorLabel: projected.actorLabel,
          at: now,
        })
        .catch((err) =>
          console.error("[activity-observer] pubby trigger failed:", err instanceof Error ? err.message : err),
        );
    }
  }
}

export function registerActivityObserver(): void {
  console.log("[activity-observer] Registering Activity observer");
  eventBus.on<RepoIndexedEvent>("repo-indexed", handle);
  eventBus.on<RepoAnalyzedEvent>("repo-analyzed", handle);
  eventBus.on<ReviewRequestedEvent>("review-requested", handle);
  eventBus.on<ReviewCompletedEvent>("review-completed", handle);
  eventBus.on<ReviewFailedEvent>("review-failed", handle);
  eventBus.on<KnowledgeReadyEvent>("knowledge-ready", handle);
  eventBus.on<CommunityReviewEvent>("community-review", handle);
}
