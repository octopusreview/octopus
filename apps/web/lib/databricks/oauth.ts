import "server-only";
import { config } from "./config";

/**
 * Workspace M2M OAuth token cache + lazy refresh.
 *
 * Mints a Databricks workspace access token using the app's service principal
 * (DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET). Token TTL is typically
 * 3600s; we refresh 60s before expiry, dedupe concurrent refreshes via a
 * single in-flight promise.
 */

type CachedToken = { token: string; expiresAt: number };

let cached: CachedToken | null = null;
let inflight: Promise<string> | null = null;

const REFRESH_BUFFER_MS = 60_000;

async function mintToken(): Promise<CachedToken> {
  const tokenUrl = `${config.host}/oidc/v1/token`;
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "all-apis",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Databricks OAuth token endpoint returned ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  const expiresAt = Date.now() + json.expires_in * 1000;
  return { token: json.access_token, expiresAt };
}

export async function getWorkspaceToken(): Promise<string> {
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

/** Force-clear the cache (test helper / 401 recovery). */
export function invalidateWorkspaceToken(): void {
  cached = null;
}
