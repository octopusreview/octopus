/**
 * Model catalogue per provider. Hardcoded today; matches the planned
 * GET /api/cli/models?provider=<slug> endpoint shape so the upgrade path
 * is one fetch swap.
 *
 * Prices are USD per million tokens (input / output). Reference prices as
 * of 2026-05; keep in sync with apps/web/lib/cost.ts and the AvailableModel
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
    { modelId: "claude-sonnet-4-6-20250619", displayName: "Claude Sonnet 4.6", inputPrice: 3, outputPrice: 15, isDefault: true },
    { modelId: "claude-opus-4-6-20250619", displayName: "Claude Opus 4.6", inputPrice: 15, outputPrice: 75 },
    { modelId: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5", inputPrice: 1, outputPrice: 5 },
  ],
  openai: [
    { modelId: "gpt-4o", displayName: "GPT-4o", inputPrice: 2.5, outputPrice: 10, isDefault: true },
    { modelId: "gpt-4o-mini", displayName: "GPT-4o mini", inputPrice: 0.15, outputPrice: 0.6 },
    { modelId: "o4-mini", displayName: "o4-mini (reasoning)", inputPrice: 1.1, outputPrice: 4.4 },
    { modelId: "codex-mini-latest", displayName: "Codex mini", inputPrice: 1.5, outputPrice: 6 },
  ],
  google: [
    { modelId: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", inputPrice: 1.25, outputPrice: 10, isDefault: true },
    { modelId: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", inputPrice: 0.15, outputPrice: 0.6 },
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
