import { getRedis } from "./redis";

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

/**
 * Fixed-window rate limiter backed by Redis (INCR + EX).
 *
 * Fails open: if Redis is unavailable or errors, the request is allowed. This
 * keeps a Redis outage from blocking legitimate traffic; the limiter is an
 * abuse guard, not a correctness dependency.
 */
export async function fixedWindowLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const redis = getRedis();
  if (!redis) {
    return { ok: true, remaining: limit, retryAfterSeconds: 0 };
  }

  const redisKey = `rl:${key}`;
  try {
    const count = await redis.incr(redisKey);

    // Set the window TTL on first hit. Also re-arm it if a prior EXPIRE was
    // lost (ttl === -1 means the key exists with no expiry), so a counter can
    // never get stuck high forever.
    if (count === 1) {
      await redis.expire(redisKey, windowSeconds);
    } else {
      const ttl = await redis.ttl(redisKey);
      if (ttl < 0) await redis.expire(redisKey, windowSeconds);
    }

    if (count > limit) {
      let ttl = await redis.ttl(redisKey);
      if (ttl < 0) ttl = windowSeconds;
      return { ok: false, remaining: 0, retryAfterSeconds: ttl };
    }

    return { ok: true, remaining: Math.max(0, limit - count), retryAfterSeconds: 0 };
  } catch (err) {
    console.error("[rate-limit] redis error:", (err as Error).message);
    return { ok: true, remaining: limit, retryAfterSeconds: 0 };
  }
}

/**
 * Build a 429 response carrying a Retry-After header (seconds).
 */
export function tooManyRequests(message: string, retryAfterSeconds: number) {
  return Response.json(
    { error: message, retryAfterSeconds },
    {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, retryAfterSeconds)) },
    },
  );
}
