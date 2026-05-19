/**
 * Tiny JSON-over-HTTP helpers for the CLI. No external HTTP library —
 * keeps the compiled binary slim and avoids dependency surface.
 *
 * Convention: every call returns { ok: true, data } | { ok: false, status, error }.
 * Callers branch on `.ok` instead of try/catch around fetch.
 */

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; status: number; error: string };
export type ApiResult<T> = ApiOk<T> | ApiErr;

const USER_AGENT = "octp-cli/0.1";

export type PostJsonOptions = {
  /**
   * Per-request timeout in ms. Pass when the call may legitimately take a
   * long time (eg. LLM-backed review endpoints) — without it the CLI hangs
   * indefinitely if the server stalls. Implemented with AbortController.
   */
  timeoutMs?: number;
};

export async function postJson<T>(
  url: string,
  body: unknown,
  bearerToken?: string,
  options: PostJsonOptions = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": USER_AGENT,
  };
  if (bearerToken) headers.authorization = `Bearer ${bearerToken}`;

  const init: RequestInit = {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  };
  if (options.timeoutMs && options.timeoutMs > 0) {
    init.signal = AbortSignal.timeout(options.timeoutMs);
  }
  return await jsonRequest<T>(url, init);
}

export async function getJson<T>(url: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  return await jsonRequest<T>(url, {
    ...init,
    method: "GET",
    headers: { "user-agent": USER_AGENT, ...(init.headers || {}) },
  });
}

async function jsonRequest<T>(url: string, init: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (e) {
    // AbortError surfaces as a generic "AbortError" which is unhelpful; map
    // it to something the user can act on. Network failures bubble through
    // unchanged.
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) {
      return { ok: false, status: 0, error: `Request timed out — ${msg}` };
    }
    return { ok: false, status: 0, error: msg };
  }

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Non-JSON body — return the raw text as the error message for diagnostics.
      if (!response.ok) {
        return { ok: false, status: response.status, error: text.slice(0, 200) };
      }
    }
  }

  if (!response.ok) {
    const error =
      typeof parsed === "object" && parsed !== null && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${response.status}`;
    return { ok: false, status: response.status, error };
  }

  return { ok: true, data: parsed as T };
}

/**
 * Normalise a base URL — strip trailing slashes, ensure scheme. Returns null
 * if the input is not a parseable http/https URL.
 */
export function normalizeBaseUrl(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}
