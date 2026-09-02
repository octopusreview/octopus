/**
 * Request-shaping helpers for the Alibaba Cloud Model Studio (DashScope)
 * provider. Kept free of `server-only` so they can be unit-tested.
 */

/** International (Singapore) endpoint. The China endpoint is
 *  https://dashscope.aliyuncs.com/compatible-mode/v1 — set DASHSCOPE_BASE_URL. */
export const ALIBABA_DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

/** DASHSCOPE_BASE_URL overrides the default; trailing slashes are trimmed. */
export function alibabaBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.DASHSCOPE_BASE_URL?.trim();
  return (raw ? raw : ALIBABA_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/**
 * Qwen3.8-Max is a hybrid-thinking model with thinking ON by default. In
 * compatible mode thinking is toggled with the vendor extension
 * `enable_thinking`, and `max_completion_tokens` caps thinking + answer
 * together (DashScope deprecates `max_tokens`). Two rules:
 *  - a caller's explicit `thinking: "disabled"` turns thinking off;
 *  - structured-output (json_schema) calls also run thinking-off, because the
 *    vendor docs warn thinking-mode JSON may not be strictly valid.
 * When thinking stays on, the cap is raised to a floor so the chain of thought
 * cannot starve the answer (the model's output ceiling is 131k tokens).
 */
export const ALIBABA_THINKING_MAX_TOKENS_FLOOR = 32_768;

/**
 * Models this adapter knows to be hybrid-thinking (thinking on by default,
 * accept `enable_thinking`, 131k output ceiling). Everything else routed to
 * the alibaba provider (any `provider = "alibaba"` catalog row, e.g. a plain
 * qwen-plus) is called as a vanilla OpenAI-compatible model: no vendor
 * extension, caller's max tokens verbatim — same reasoning as the Anthropic
 * always-thinking floor being scoped to a known model set.
 */
export const ALIBABA_HYBRID_THINKING_MODEL_RX = /^qwen3\.8-max/;

export type AlibabaRequestShape = {
  maxCompletionTokens: number;
  /** undefined = omit the vendor field entirely (model is not known to support it). */
  enableThinking: boolean | undefined;
};

export function alibabaRequestShape(params: {
  model: string;
  maxTokens: number;
  thinking?: "disabled";
  responseSchema?: unknown;
}): AlibabaRequestShape {
  if (!ALIBABA_HYBRID_THINKING_MODEL_RX.test(params.model)) {
    return { maxCompletionTokens: params.maxTokens, enableThinking: undefined };
  }
  const enableThinking = params.thinking !== "disabled" && params.responseSchema === undefined;
  const maxCompletionTokens = enableThinking
    ? Math.max(params.maxTokens, ALIBABA_THINKING_MAX_TOKENS_FLOOR)
    : params.maxTokens;
  return { maxCompletionTokens, enableThinking };
}
