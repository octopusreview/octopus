import "server-only";

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

export function presenceIndexKey(orgId: string): string {
  return `presence:index:${orgId}`;
}

export async function recordPresence(
  orgId: string,
  userId: string,
  currentActivity: string | null,
): Promise<void> {
  const redis = getRedis();
  if (redis) {
    const lastSeenAt = Date.now();
    const key = presenceKey(orgId, userId);
    const indexKey = presenceIndexKey(orgId);
    const value = JSON.stringify({ userId, currentActivity, lastSeenAt });
    // Fire-and-forget: the client (enableOfflineQueue:false) rejects awaited
    // commands during a Redis blip, so a heartbeat must never 500 on Redis.
    void Promise.all([
      redis.set(key, value, "EX", PRESENCE_TTL_SECONDS),
      redis.zadd(
        indexKey,
        lastSeenAt + PRESENCE_TTL_SECONDS * 1000,
        key,
      ),
      redis.expire(indexKey, PRESENCE_TTL_SECONDS * 2),
    ])
      .catch((err) => console.error("[presence] redis write failed:", err instanceof Error ? err.message : err));
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
    const key = presenceKey(orgId, userId);
    void Promise.all([
      redis.del(key),
      redis.zrem(presenceIndexKey(orgId), key),
    ])
      .catch((err) => console.error("[presence] redis clear failed:", err instanceof Error ? err.message : err));
  }
  try {
    await prisma.userPresence.deleteMany({ where: { organizationId: orgId, userId } });
  } catch (err) {
    console.error("[presence] db delete failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Read the currently-online members for an org. Redis-primary (an org-scoped
 * expiry index followed by MGET); Postgres fallback derives online from
 * lastSeenAt within the staleness window. Returns presence entries WITHOUT
 * display info; callers join user name/image. Never throws — returns [] on any
 * backend error so the dashboard degrades gracefully.
 */
export async function getOnlinePresence(orgId: string): Promise<PresenceEntry[]> {
  const redis = getRedis();
  if (redis) {
    try {
      const now = Date.now();
      const indexKey = presenceIndexKey(orgId);
      await redis.zremrangebyscore(indexKey, "-inf", now);
      const keys = await redis.zrangebyscore(indexKey, `(${now}`, "+inf");
      if (keys.length === 0) return [];

      const values = await redis.mget(...keys);
      const entries: PresenceEntry[] = [];
      const staleKeys: string[] = [];

      for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        const key = keys[index];
        if (value === null) {
          if (key) staleKeys.push(key);
          continue;
        }
        try {
          const entry = JSON.parse(value) as PresenceEntry;
          if (entry && typeof entry.userId === "string") {
            entries.push(entry);
          } else if (key) {
            staleKeys.push(key);
          }
        } catch {
          if (key) staleKeys.push(key);
        }
      }

      if (staleKeys.length > 0) {
        // Cleanup should not turn an otherwise successful roster read into an
        // error when Redis is degraded.
        void redis
          .zrem(indexKey, ...staleKeys)
          .catch((err) => console.error("[presence] redis index cleanup failed:", err instanceof Error ? err.message : err));
      }

      return entries;
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
