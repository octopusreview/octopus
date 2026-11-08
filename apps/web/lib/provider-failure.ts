import type { AiProvider } from "./providers";
import { EmbeddingDimensionError, MissingEmbeddingKeyError, OllamaEmbeddingResponseError, OllamaEmbeddingUrlError } from "./embedding-error";

export type KeyOwner = "platform" | "organization" | "unknown";
const OFFLINE_LOCAL_AGENT_MESSAGE = "No local agent is online for this organisation. Run `octp agent serve` on a machine with the API token.";

export class OfflineLocalAgentError extends Error {
  constructor() { super(OFFLINE_LOCAL_AGENT_MESSAGE); }
}
const SAFE_ERROR_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ConnectionRefused", "ETIMEDOUT", "ENETUNREACH", "EAI_AGAIN", "ENOTFOUND", "ENOENT", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "PROVIDER_REFUSAL"]);
const ERROR_NAMES = new Set(["Error", "TypeError", "APIError", "APIConnectionError", "APIConnectionTimeoutError", "AuthenticationError", "PermissionDeniedError", "RateLimitError", "InternalServerError", "TimeoutError", "AbortError"]);

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

export class AiProviderFailure extends Error {
  readonly details: ReturnType<typeof safeErrorDetails>;
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
    this.reviewCategory = reviewCategory;
  }
}

export function providerKeyOwner(provider: AiProvider, hasOrgKey: boolean): KeyOwner {
  if (hasOrgKey) return "organization";
  // These adapters resolve per-org endpoints/credentials internally.
  if (["local", "ollama", "claude-code", "acp", "opencode"].includes(provider)) return "unknown";
  return "platform";
}
