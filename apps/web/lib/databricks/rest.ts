import "server-only";
import { config } from "./config";
import { getWorkspaceToken, invalidateWorkspaceToken } from "./oauth";

/**
 * Thin fetch wrapper around the Databricks REST API.
 *
 * Attaches the workspace M2M bearer token to every call, retries once on 401
 * after invalidating the cached token. Returns the parsed JSON body on 2xx
 * responses; throws on non-2xx with the response text included.
 */

export async function dbxFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith("http") ? path : `${config.host}${path}`;

  async function attempt(): Promise<Response> {
    const token = await getWorkspaceToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return fetch(url, { ...init, headers });
  }

  let res = await attempt();
  if (res.status === 401) {
    invalidateWorkspaceToken();
    res = await attempt();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Databricks ${init.method ?? "GET"} ${path} → ${res.status} ${res.statusText}: ${text}`);
  }
  // Some endpoints return empty 200 / 204; handle gracefully.
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(`Databricks ${path} returned non-JSON body: ${text.slice(0, 200)}`);
  }
}

/** Raw fetch returning the Response — for endpoints that stream or return non-JSON. */
export async function dbxFetchRaw(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${config.host}${path}`;
  const token = await getWorkspaceToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, { ...init, headers });
}
