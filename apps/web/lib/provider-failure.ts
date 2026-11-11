import type { AiProvider } from "./providers";
import { EmbeddingDimensionError, MissingEmbeddingKeyError, OllamaEmbeddingResponseError, OllamaEmbeddingUrlError } from "./embedding-error";

export type KeyOwner = "platform" | "organization" | "unknown";
const OFFLINE_LOCAL_AGENT_MESSAGE = "No local agent is online for this organisation. Run `octp agent serve` on a machine with the API token.";

export class OfflineLocalAgentError extends Error {
  constructor() { super(OFFLINE_LOCAL_AGENT_MESSAGE); }
}
const SAFE_ERROR_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ConnectionRefused", "ETIMEDOUT", "ENETUNREACH", "EAI_AGAIN", "ENOTFOUND", "ENOENT", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "PROVIDER_REFUSAL", "STREAM_TERMINATED"]);
const ERROR_NAMES = new Set(["Error", "TypeError", "APIError", "APIConnectionError", "APIConnectionTimeoutError", "AuthenticationError", "PermissionDeniedError", "RateLimitError", "InternalServerError", "TimeoutError", "AbortError"]);

/** Codes that may be shown to customers: the fixed allowlist and the forms derived from an HTTP status. */
export const isSafeFailureCode = (code: unknown): code is string => typeof code === "string" && (SAFE_ERROR_CODES.has(code) || code === "unclassified" || /^http_[45]\d\d$/.test(code));

/** Only retain diagnostic primitives; never attach an SDK request/response or raw cause. */
export function safeErrorDetails(error: unknown) {
  const details: { name: string; code?: string; status?: number; category?: string } = { name: "Error" };
  const seen = new Set<unknown>();
  for (let value = error, depth = 0; value && typeof value === "object" && depth < 4 && !seen.has(value); depth++) {
    seen.add(value);
    try {
      if (value instanceof EmbeddingDimensionError) details.category ??= "embedding_dimension_mismatch";
      else if (value instanceof MissingEmbeddingKeyError) details.category ??= "embedding_key_missing";
      else if (value instanceof OllamaEmbeddingResponseError) details.category ??= "ollama_embedding_response_invalid";
      else if (value instanceof OllamaEmbeddingUrlError) details.category ??= "ollama_embedding_url_invalid";
      const item = value as Record<string, unknown>;
      if (typeof item.name === "string" && ERROR_NAMES.has(item.name)) details.name = item.name;
      if (typeof item.code === "string" && SAFE_ERROR_CODES.has(item.code)) details.code ??= item.code;
      if (typeof item.status === "number" && Number.isInteger(item.status) && item.status >= 400 && item.status <= 599) details.status ??= item.status;
      if (item.message === "terminated") details.code ??= "STREAM_TERMINATED";
      value = item.cause;
    } catch { break; }
  }
  return details;
}

/** A provider Retry-After as a non-negative delay; only the number is kept, never header text. */
function retryAfterMs(error: unknown): number | undefined {
  try {
    const headers = (error as { headers?: unknown } | null)?.headers;
    const raw = headers instanceof Headers ? headers.get("retry-after") : (headers as Record<string, unknown> | null | undefined)?.["retry-after"];
    if (typeof raw !== "string" || !raw.trim()) return undefined;
    const ms = Number.isFinite(Number(raw)) ? Number(raw) * 1000 : Date.parse(raw) - Date.now();
    return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms)) : undefined;
  } catch { return undefined; }
}

export class AiProviderFailure extends Error {
  readonly details: ReturnType<typeof safeErrorDetails>;
  readonly retryAfterMs?: number;
  readonly reviewCategory?: "auth" | "local";
  constructor(error: unknown, readonly provider: AiProvider, readonly model: string, readonly keyOwner: KeyOwner) {
    const details = safeErrorDetails(error);
    let message = "";
    try { message = (error instanceof Error ? error.message : String(error)).toLowerCase(); } catch {}
    const cancelled = details.name === "AbortError" || (error instanceof Error && error.name === "AbortError");
    const authFailure = details.status !== undefined
      ? details.status === 401 || details.status === 403
      : /invalid_api_key|api key|unauthorized|401|403|authentication|placeholder/.test(message);
    const reviewCategory = !cancelled && authFailure
      ? "auth" : !cancelled && provider === "ollama" && !details.status && (details.code ? ["ECONNREFUSED", "ConnectionRefused", "ENETUNREACH", "EAI_AGAIN", "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT"].includes(details.code) : /(econnrefused|fetch failed)/.test(message))
        ? "local" : undefined;
    const hint = provider === "claude-code" && details.code === "ENOENT" ? ": executable or file not found; check the provider installation" : "";
    super(provider === "local" && error instanceof OfflineLocalAgentError
      ? OFFLINE_LOCAL_AGENT_MESSAGE
      : `AI provider ${provider} request failed${details.status ? ` (HTTP ${details.status})` : ""}${hint}`);
    this.name = "AiProviderFailure";
    this.details = details;
    this.retryAfterMs = retryAfterMs(error);
    this.reviewCategory = reviewCategory;
  }
}

const TRANSIENT_CODES = new Set(["STREAM_TERMINATED", "ECONNRESET", "UND_ERR_SOCKET", "UND_ERR_BODY_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "ETIMEDOUT"]);
export type FailureClass = { code: string; ownership: KeyOwner; retryability: "transient" | "permanent" | "unknown" };

/** Classify by cause and credential route, not HTTP status alone. Only "transient" may ever be retried; unknown stays unknown. */
export function classifyFailure(details: { name?: string; code?: string; status?: number }, keyOwner: KeyOwner, stage: string, cancelled = false): FailureClass {
  const { status } = details;
  const code = details.code ?? (status ? `http_${status}` : "unclassified");
  const result = (ownership: KeyOwner, retryability: FailureClass["retryability"]): FailureClass => ({ code, ownership, retryability });
  if (cancelled || details.name === "AbortError") return result("unknown", "permanent");
  // Other stages carry statuses from Git hosts or storage, which say nothing about the AI credential route.
  if (stage !== "generation") return result("unknown", "unknown");
  if (status === 401 || status === 402 || status === 403) return result(keyOwner, "permanent");
  if (status === 429) return result(keyOwner, keyOwner === "platform" ? "transient" : keyOwner === "organization" ? "permanent" : "unknown");
  if (status !== undefined && [500, 502, 503, 504, 529].includes(status)) return result(keyOwner === "platform" ? "platform" : "unknown", "transient");
  if (status !== undefined && [400, 404, 413, 422].includes(status)) return result("unknown", "permanent");
  if (details.code === "PROVIDER_REFUSAL") return result("unknown", "permanent");
  if (details.code && TRANSIENT_CODES.has(details.code)) return result("unknown", "transient");
  return result("unknown", "unknown");
}

export function providerKeyOwner(provider: AiProvider, hasOrgKey: boolean): KeyOwner {
  if (hasOrgKey) return "organization";
  // These adapters resolve per-org endpoints/credentials internally.
  if (["local", "ollama", "claude-code", "acp", "opencode"].includes(provider)) return "unknown";
  return "platform";
}
