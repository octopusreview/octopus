import "server-only";
import { config } from "./config";
import { dbxFetch } from "./rest";

/**
 * Lakebase Postgres password vending.
 *
 * The Databricks Apps platform CAN auto-inject PGHOST / PGUSER / PGPASSWORD /
 * PGDATABASE / PGPORT via the `database` app-resource binding. When those
 * are present we use them directly. Otherwise (local dev, or running outside
 * an App container), we mint a 1-hour OAuth token via the Postgres credential
 * API and cache it with a 5-minute refresh buffer.
 */

type CachedPg = { token: string; expiresAt: number };

let cached: CachedPg | null = null;
let inflight: Promise<string> | null = null;

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

/**
 * Return the current Lakebase password.
 *
 * In a Databricks App with a `database` resource binding, `PGPASSWORD` is
 * already a fresh short-lived token; we return it as-is. Outside that
 * context we mint one ourselves and cache.
 */
export async function getLakebasePassword(): Promise<string> {
  // Path 1: App-injected
  if (process.env.PGPASSWORD) return process.env.PGPASSWORD;

  // Path 2: cached fresh token
  if (cached && Date.now() < cached.expiresAt - REFRESH_BUFFER_MS) {
    return cached.token;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      cached = await mintToken();
      return cached.token;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function mintToken(): Promise<CachedPg> {
  // POST /api/2.0/database/credentials
  // Body: { request_id, instance_names: [ "<project>" ] }
  const requestId = `octopus-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const body = JSON.stringify({
    request_id: requestId,
    instance_names: [config.lakebaseProject],
  });

  const json = await dbxFetch<{ token: string; expiration_time: string }>(
    "/api/2.0/database/credentials",
    { method: "POST", body },
  );

  const expiresAt =
    json.expiration_time && !Number.isNaN(Date.parse(json.expiration_time))
      ? Date.parse(json.expiration_time)
      : Date.now() + 60 * 60 * 1000; // default 1h

  return { token: json.token, expiresAt };
}

/** Test helper / 401 recovery: drop the cached token so the next call re-mints. */
export function invalidateLakebasePassword(): void {
  cached = null;
}
