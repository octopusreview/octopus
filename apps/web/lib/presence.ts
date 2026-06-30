import { prisma } from "@octopus/db";
import { getRedis } from "@/lib/redis";

/**
 * Human-user live presence. Redis-primary (key-per-user with TTL, so "online"
 * is exactly "key still exists" and stale members self-expire), with a Postgres
 * fallback when Redis is not configured (e.g. self-host without REDIS_URL).
 *
 * Only a coarse activity category and a last-seen timestamp are stored — never
 * IP, full path, or any resource name.
 */

export type PresenceEntry = {
  userId: string;
  currentActivity: string | null;
  lastSeenAt: number; // epoch ms
};

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

/**
 * Remove a member's presence immediately (e.g. when they opt out), so they
 * disappear from the roster at once rather than after the TTL. Best-effort and
 * null-safe — clears both the Redis key and any Postgres fallback row.
 */
export async function clearPresence(orgId: string, userId: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    redis
      .del(presenceKey(orgId, userId))
      .catch((err) => console.error("[presence] redis del failed:", err instanceof Error ? err.message : err));
  }
  try {
    await prisma.userPresence.deleteMany({ where: { organizationId: orgId, userId } });
  } catch (err) {
    console.error("[presence] db delete failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Read the currently-online members for an org. Redis-primary (SCAN — never
 * KEYS, which blocks the server — then MGET); Postgres fallback derives online
 * from lastSeenAt within the staleness window. Returns presence entries WITHOUT
 * display info; callers join user name/image. Never throws — returns [] on any
 * backend error so the dashboard degrades gracefully.
 */
export async function getOnlinePresence(orgId: string): Promise<PresenceEntry[]> {
  const redis = getRedis();
  if (redis) {
    try {
      const pattern = `presence:${orgId}:*`;
      const keys: string[] = [];
      let cursor = "0";
      do {
        const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
        cursor = next;
        keys.push(...batch);
      } while (cursor !== "0");
      if (keys.length === 0) return [];
      const values = await redis.mget(...keys);
      return values
        .filter((v): v is string => v !== null)
        .map((v) => {
          try {
            return JSON.parse(v) as PresenceEntry;
          } catch {
            return null;
          }
        })
        .filter((e): e is PresenceEntry => e !== null && typeof e.userId === "string");
    } catch (err) {
      console.error("[presence] redis read failed:", err instanceof Error ? err.message : err);
      return [];
    }
  }

  // Postgres fallback.
  try {
    const since = new Date(Date.now() - PRESENCE_STALE_MS);
    const rows = await prisma.userPresence.findMany({
      where: { organizationId: orgId, lastSeenAt: { gte: since } },
      select: { userId: true, currentActivity: true, lastSeenAt: true },
    });
    return rows.map((r) => ({
      userId: r.userId,
      currentActivity: r.currentActivity,
      lastSeenAt: r.lastSeenAt.getTime(),
    }));
  } catch (err) {
    console.error("[presence] db read failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
