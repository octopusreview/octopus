/**
 * Extended-thinking configuration for Anthropic models.
 *
 * Claude-5-family models (Fable 5, Opus 5, Mythos, …) emit extended-thinking
 * blocks that spend from the max_tokens budget BEFORE any text. The small
 * review/title budgets (8192 / 256) get consumed by thinking on hard inputs, so
 * the response ends with stop_reason "max_tokens" and zero text blocks — an
 * empty review. So for these models we raise max_tokens to a floor (a ceiling,
 * not a spend — free on easy inputs) so thinking has room to finish and still
 * answer. The floor is applied ONLY to this known set: other models have lower
 * per-model max_tokens caps (e.g. 8192), and blindly raising to 64000 would get
 * a 400 rejected.
 *
 * The always-on-thinking models additionally REJECT `thinking.type: "enabled"`
 * with an explicit budget ("not supported for this model") — they require
 * `thinking.type: "adaptive"` plus `output_config.effort`. Adaptive lets the
 * model balance thinking vs. answer within max_tokens so it isn't starved.
 *
 * Kept out of anthropic.ts (which is `server-only`) so it stays unit-testable.
 */
// Models that emit always-on thinking and need the adaptive config (confirmed
// by their "use thinking.type.adaptive" API error). Opus 5 shares the Claude-5
// thinking API with Fable 5.
export const ALWAYS_THINKING_MODEL_RX = /^claude-(?:fable|mythos)-|^claude-opus-5(?:-|$)/;
export const ALWAYS_THINKING_MAX_TOKENS_FLOOR = 64000;

export type ThinkingEffort = "low" | "medium" | "high" | "xhigh" | "max";
export const VALID_EFFORTS: readonly ThinkingEffort[] = ["low", "medium", "high", "xhigh", "max"];
export const DEFAULT_THINKING_EFFORT: ThinkingEffort = "medium";

/** Narrow an arbitrary string to a valid ThinkingEffort (else undefined). */
export function asThinkingEffort(v: string | null | undefined): ThinkingEffort | undefined {
  return v && (VALID_EFFORTS as readonly string[]).includes(v) ? (v as ThinkingEffort) : undefined;
}

/** Env fallback effort (FABLE_THINKING_EFFORT), else the built-in default. */
export function resolveEffort(): ThinkingEffort {
  return asThinkingEffort(process.env.FABLE_THINKING_EFFORT) ?? DEFAULT_THINKING_EFFORT;
}

/**
 * A caller's explicit `thinking: "disabled"` wins on models that allow it.
 * Always-thinking models (Fable/Mythos/Opus 5) reject thinking-off, so they
 * keep whatever resolveThinking produced.
 */
export function resolveThinkingOverride(
  model: string,
  requested: "disabled" | undefined,
  resolved: { type: "adaptive" } | undefined,
): { type: "adaptive" } | { type: "disabled" } | undefined {
  if (requested === "disabled" && !ALWAYS_THINKING_MODEL_RX.test(model)) {
    return { type: "disabled" };
  }
  return resolved;
}

export type ResolvedThinking = {
  maxTokens: number;
  thinking?: { type: "adaptive" };
  outputConfig?: { effort: ThinkingEffort };
};

/**
 * For a thinking-heavy model (ALWAYS_THINKING_MODEL_RX), raise max_tokens to the
 * floor so thinking can't starve the answer, and additionally set adaptive
 * thinking + an effort level. All other models are returned with their
 * requested max_tokens unchanged (no floor — their per-model cap may be lower).
 *
 * Adaptive is applied only on the plain-text path: the forced-`tool_choice`
 * (structured output) path keeps the floor alone and leaves thinking implicit,
 * to avoid thinking/tool_choice interactions.
 */
export function resolveThinking(
  model: string,
  requestedMaxTokens: number,
  useTool: boolean,
  effort?: ThinkingEffort,
): ResolvedThinking {
  // Only the known thinking-heavy Claude-5 models get the floor — they have
  // high per-model caps (>= 64000) and need the room. Other models keep their
  // requested budget so we never exceed a lower cap (a 400).
  if (!ALWAYS_THINKING_MODEL_RX.test(model)) return { maxTokens: requestedMaxTokens };
  const maxTokens = Math.max(requestedMaxTokens, ALWAYS_THINKING_MAX_TOKENS_FLOOR);
  if (useTool) return { maxTokens };
  return {
    maxTokens,
    thinking: { type: "adaptive" },
    // Caller-resolved effort (org override → platform default) wins; else the
    // env/built-in default.
    outputConfig: { effort: effort ?? resolveEffort() },
  };
}
