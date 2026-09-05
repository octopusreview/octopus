/**
 * Model catalogue per provider. Hardcoded today; matches the planned
 * GET /api/cli/models?provider=<slug> endpoint shape so the upgrade path
 * is one fetch swap.
 *
 * Prices are USD per million tokens (input / output). Reference prices as
 * of 2026-09 (Octopus Cloud catalog); keep in sync with apps/web/lib/cost.ts and the AvailableModel
 * Prisma rows seeded in packages/db/prisma/seed.ts.
 */
export type ModelInfo = {
  modelId: string;
  displayName: string;
  /** USD per million input tokens. */
  inputPrice: number;
  /** USD per million output tokens. */
  outputPrice: number;
  /** Default-recommended model for the provider. */
  isDefault?: boolean;
};

// Anthropic model IDs are the *dated* canonical forms (matching what the
// server seeds and prices). Undated aliases like "claude-sonnet-4-6" are
// API aliases that route to the same model but DO NOT match server-side
// pricing lookup (cost.ts does exact-key get with no alias fallback) —
// so usage logged under an undated id silently prices to $0 and bypasses
// the org spend-limit check. Pricing fields below match cost.ts's
// FALLBACK_PRICING + seed.ts exactly.
export const MODELS_BY_PROVIDER: Record<string, ModelInfo[]> = {
  anthropic: [
    { modelId: "claude-fable-5-1", displayName: "Claude Fable 5.1", inputPrice: 10, outputPrice: 50 },
    { modelId: "claude-fable-5", displayName: "Claude Fable 5", inputPrice: 10, outputPrice: 50 },
    { modelId: "claude-opus-5", displayName: "Claude Opus 5", inputPrice: 5, outputPrice: 25, isDefault: true },
    { modelId: "claude-sonnet-5", displayName: "Claude Sonnet 5", inputPrice: 2, outputPrice: 10 },
    { modelId: "claude-opus-4-8", displayName: "Claude Opus 4.8", inputPrice: 5, outputPrice: 25 },
    { modelId: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5", inputPrice: 1, outputPrice: 5 },
  ],
  openai: [
    { modelId: "gpt-6-astra", displayName: "GPT-6 Astra", inputPrice: 10, outputPrice: 50 },
    { modelId: "gpt-5.3-codex", displayName: "GPT-5.3 Codex", inputPrice: 1.75, outputPrice: 14, isDefault: true },
  ],
  google: [
    { modelId: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", inputPrice: 1.25, outputPrice: 10, isDefault: true },
    { modelId: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", inputPrice: 0.15, outputPrice: 0.6 },
  ],
  alibaba: [
    { modelId: "qwen3.8-max-0902", displayName: "Qwen3.8-Max-0902", inputPrice: 2, outputPrice: 6, isDefault: true },
  ],
  // Coming-soon providers: empty until their model lists are seeded by the
  // backend. The CLI handles the empty case with a friendly message.
  "claude-code": [],
  codex: [],
  opencode: [],
  grok: [],
  openrouter: [],
  acp: [],
  ollama: [],
};

export function modelsFor(providerSlug: string): ModelInfo[] {
  return MODELS_BY_PROVIDER[providerSlug] ?? [];
}

export function defaultModelFor(providerSlug: string): ModelInfo | null {
  const list = modelsFor(providerSlug);
  return list.find((m) => m.isDefault) ?? list[0] ?? null;
}

/**
 * Format a price as "$3 / $15 per 1M tokens" — short enough to fit on one
 * line in the SelectInput label.
 */
export function formatPrice(m: ModelInfo): string {
  const fmt = (n: number) => (n >= 1 ? `$${n}` : `$${n.toFixed(2).replace(/\.?0+$/, "")}`);
  return `${fmt(m.inputPrice)} / ${fmt(m.outputPrice)} per 1M`;
}
