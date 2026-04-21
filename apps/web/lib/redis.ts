import Redis, { type RedisOptions } from "ioredis";

let client: Redis | null = null;
let disabled = false;

function buildClient(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  const opts: RedisOptions = {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  };

  const r = new Redis(url, opts);
  r.on("error", (err) => {
    console.error("[redis] error:", err.message);
  });
  return r;
}

export function getRedis(): Redis | null {
  if (disabled) return null;
  if (!client) {
    client = buildClient();
    if (!client) disabled = true;
  }
  return client;
}
