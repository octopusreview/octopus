import type { AiProvider } from "./providers";

export type KeyOwner = "platform" | "organization" | "unknown";
const SAFE_ERROR_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH", "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "PROVIDER_REFUSAL"]);
const ERROR_NAMES = new Set(["Error", "TypeError", "APIError", "APIConnectionError", "APIConnectionTimeoutError", "AuthenticationError", "PermissionDeniedError", "RateLimitError", "InternalServerError", "TimeoutError", "AbortError"]);

/** Only retain diagnostic primitives; never attach an SDK request/response or raw cause. */
export function safeErrorDetails(error: unknown) {
  const details: { name: string; code?: string; status?: number; requestId?: string } = { name: "Error" };
  const seen = new Set<unknown>();
  for (let value = error, depth = 0; value && typeof value === "object" && depth < 4 && !seen.has(value); depth++) {
    seen.add(value);
    const item = value as Record<string, unknown>;
    if (typeof item.name === "string" && ERROR_NAMES.has(item.name)) details.name = item.name;
    if (typeof item.code === "string" && SAFE_ERROR_CODES.has(item.code)) details.code ??= item.code;
    if (typeof item.status === "number" && Number.isInteger(item.status) && item.status >= 400 && item.status <= 599) details.status ??= item.status;
    const requestId = item.request_id ?? item.requestID;
    if (typeof requestId === "string" && /^(req_[a-zA-Z0-9]{8,80}|[a-f0-9]{8}-[a-f0-9-]{27,36})$/.test(requestId)) details.requestId ??= requestId;
    if (item.message === "terminated") details.code ??= "STREAM_TERMINATED";
    value = item.cause;
  }
  return details;
}

export class AiProviderFailure extends Error {
  readonly details: ReturnType<typeof safeErrorDetails>;
  constructor(error: unknown, readonly provider: AiProvider, readonly model: string, readonly keyOwner: KeyOwner) {
    super(`AI provider ${provider} failed: ${error instanceof Error ? error.message : String(error)}`);
    this.name = "AiProviderFailure";
    this.details = safeErrorDetails(error);
  }
}

export function providerKeyOwner(provider: AiProvider, hasOrgKey: boolean): KeyOwner {
  if (hasOrgKey) return "organization";
  // These adapters resolve per-org endpoints/credentials internally.
  if (["local", "ollama", "claude-code", "acp", "opencode"].includes(provider)) return "unknown";
  return "platform";
}
