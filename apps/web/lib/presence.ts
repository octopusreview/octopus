import { prisma } from "@octopus/db";
import { getRedis } from "@/lib/redis";

/**
 * Human-user live presence. Redis-primary (key-per-user with TTL, so "online"
 * is exactly "key still exists" and stale members self-expire), with a Postgres
 * fallback when Redis is not configured (e.g. self-host without REDIS_URL).
 *
 * Only a coarse activity category and a last-seen timestamp are stored — never
 * IP, full path, or any resource name. The roster READ lives with the dashboard
 * (a later slice); this module is the write path used by the heartbeat ingest.
 */

// TTL slightly above the 30s client heartbeat so one missed beat doesn't flap.
export const PRESENCE_TTL_SECONDS = 60;
// Postgres-fallback staleness window (mirrors the TTL): online := lastSeenAt
// within this window.
export const PRESENCE_STALE_MS = PRESENCE_TTL_SECONDS * 1000;

export function presenceKey(orgId: string, userId: string): string {
  return `presence:${orgId}:${userId}`;
}

export async function recordPresence(
  orgId: string,
  userId: string,
  currentActivity: string | null,
): Promise<void> {
  const redis = getRedis();
  if (redis) {
    const value = JSON.stringify({ userId, currentActivity, lastSeenAt: Date.now() });
    // Fire-and-forget: the client (enableOfflineQueue:false) rejects awaited
    // commands during a Redis blip, so a heartbeat must never 500 on Redis.
    redis
      .set(presenceKey(orgId, userId), value, "EX", PRESENCE_TTL_SECONDS)
      .catch((err) => console.error("[presence] redis set failed:", err instanceof Error ? err.message : err));
    return;
  }

  // Degraded fallback (no Redis): persist to Postgres. The roster read derives
  // "online" as lastSeenAt >= now - PRESENCE_STALE_MS.
  try {
    await prisma.userPresence.upsert({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      create: { userId, organizationId: orgId, currentActivity, lastSeenAt: new Date() },
      update: { currentActivity, lastSeenAt: new Date() },
    });
  } catch (err) {
    console.error("[presence] db upsert failed:", err instanceof Error ? err.message : err);
  }
}
