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

export async function del<T>(url: string, bearerToken?: string): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { "user-agent": USER_AGENT };
  if (bearerToken) headers.authorization = `Bearer ${bearerToken}`;
  return await jsonRequest<T>(url, { method: "DELETE", headers });
}

export type StreamResult = { ok: true } | { ok: false; status: number; error: string };

// Hard cap on the un-flushed stream buffer. A server that streams a large body
// with no newline would otherwise grow `buffer` without bound (memory DoS).
const MAX_STREAM_BUFFER = 5 * 1024 * 1024;

function streamErr(e: unknown): string {
  if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) {
    return "Request timed out";
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Open a POST stream. Resolves the non-2xx path the same way jsonRequest does
 * (parse {error} JSON, else raw text) so streaming callers get a usable error
 * instead of a half-read body. On success hands back the reader.
 */
// Returns the Response on success; each streamer calls getReader() itself so
// the (overloaded) reader type is inferred at the 0-arg call site — annotating
// it here resolves to the wrong overload (BYOB) or the wrong DOM generic.
async function openStream(
  url: string,
  body: unknown,
  bearerToken?: string,
  timeoutMs?: number,
): Promise<{ ok: true; response: Response } | ApiErr> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": USER_AGENT,
  };
  if (bearerToken) headers.authorization = `Bearer ${bearerToken}`;

  const init: RequestInit = { method: "POST", headers, body: JSON.stringify(body) };
  // Overall per-call timeout — each chat answer / analyze-deps run is a single
  // request, so an upper bound here keeps the CLI from hanging forever if the
  // server accepts the connection then stalls mid-stream.
  if (timeoutMs && timeoutMs > 0) init.signal = AbortSignal.timeout(timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) {
      return { ok: false, status: 0, error: `Request timed out — ${msg}` };
    }
    return { ok: false, status: 0, error: msg };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let error = `HTTP ${res.status}`;
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && "error" in parsed) {
          error = String((parsed as { error: unknown }).error);
        }
      } catch {
        error = text.slice(0, 200);
      }
    }
    return { ok: false, status: res.status, error };
  }
  return { ok: true, response: res };
}

/**
 * Consume a `data: {json}` line stream (NDJSON-style SSE). Ends on a
 * `data: [DONE]` sentinel or when the stream closes. `onData` is invoked for
 * each parsed JSON object; malformed lines are skipped.
 */
export async function streamData(
  url: string,
  body: unknown,
  bearerToken: string | undefined,
  onData: (data: Record<string, unknown>) => void,
  timeoutMs?: number,
): Promise<StreamResult> {
  const opened = await openStream(url, body, bearerToken, timeoutMs);
  if (!opened.ok) return opened;
  const reader = opened.response.body?.getReader();
  if (!reader) return { ok: false, status: 0, error: "No response body" };
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_STREAM_BUFFER) {
        return { ok: false, status: 0, error: "stream exceeded buffer limit without a line break" };
      }
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") return { ok: true };
        try {
          onData(JSON.parse(data) as Record<string, unknown>);
        } catch {
          // skip malformed chunk
        }
      }
    }
  } catch (e) {
    return { ok: false, status: 0, error: streamErr(e) };
  }
  return { ok: true };
}

/**
 * Consume an `event: X\ndata: {json}` SSE stream. `onEvent` receives the event
 * name + parsed data object per record.
 */
export async function streamSse(
  url: string,
  body: unknown,
  bearerToken: string | undefined,
  onEvent: (event: string, data: Record<string, unknown>) => void,
  timeoutMs?: number,
): Promise<StreamResult> {
  const opened = await openStream(url, body, bearerToken, timeoutMs);
  if (!opened.ok) return opened;
  const reader = opened.response.body?.getReader();
  if (!reader) return { ok: false, status: 0, error: "No response body" };
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_STREAM_BUFFER) {
        return { ok: false, status: 0, error: "stream exceeded buffer limit without a line break" };
      }
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ") && currentEvent) {
          try {
            onEvent(currentEvent, JSON.parse(line.slice(6)) as Record<string, unknown>);
          } catch {
            // skip malformed chunk
          }
          currentEvent = "";
        }
      }
    }
  } catch (e) {
    return { ok: false, status: 0, error: streamErr(e) };
  }
  return { ok: true };
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

/**
 * Classify a base URL as "transport-safe to send bearer tokens over":
 * HTTPS to any host, or HTTP to a loopback / private-LAN host. Cleartext
 * HTTP to a public host should warn the user before we POST the auth
 * token — that's a one-way credential leak to any on-path observer.
 *
 * Callers: AuthStep (warn before sign-in to a self-hosted http:// URL on
 * a non-local host). Returns true when transport is safe; false when the
 * caller should surface a warning + require explicit confirmation.
 */
export function isTransportSafe(baseUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  if (u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host === "::" || host.endsWith(".local")) return true;
  const v4 = host.split(".");
  if (v4.length === 4 && v4.every((p) => /^\d+$/.test(p))) {
    const [a, b] = v4.map(Number);
    if (a === 127) return true;
    if (a === 0 && b === 0 && v4[2] === "0" && v4[3] === "0") return true;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  // IPv6 link-local (fe80::/10) and ULA (fc00::/7) — must be IPv6 literals,
  // not just any hostname starting with "fc"/"fd" (the old `/^f[cd]/` test
  // matched public hostnames like "fc-host.example.com"). All IPv6 literals
  // contain a colon by definition, so requiring one rules out the false
  // positive without complicating the rest of the check.
  if (host.includes(":") && (host.startsWith("fe80:") || /^f[cd][0-9a-f]{2}:/.test(host))) {
    return true;
  }
  return false;
}
