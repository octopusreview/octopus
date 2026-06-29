/**
 * Provider catalogue for the onboarding wizard.
 *
 * Hardcoded today. When `/api/cli/providers` lands as a backend endpoint
 * (separate PR), the catalogue will be fetched at runtime so new providers
 * appear in the CLI without requiring users to upgrade. The shape of
 * `ProviderInfo` is chosen to match that future API.
 */
export type ProviderType =
  | "direct" // Raw API to the model vendor (Anthropic, OpenAI, Google)
  | "harness" // Agent harness — shells out to a CLI (codex, claude-code, opencode)
  | "gateway" // Multiplexer / aggregator (OpenRouter, ACPX)
  | "local"; // Runs on the user's machine (Ollama)

export type ProviderInfo = {
  slug: string;
  displayName: string;
  type: ProviderType;
  /** Short marketing-y blurb for the picker. */
  blurb: string;
  /** "ready" — usable today. "coming-soon" — planned, not yet implemented. */
  status: "ready" | "coming-soon";
};

export const PROVIDERS: ProviderInfo[] = [
  // Direct API providers — already implemented in apps/web/lib/ai-router.ts.
  {
    slug: "anthropic",
    displayName: "Claude (Anthropic)",
    type: "direct",
    blurb: "Direct Anthropic API. BYOK with your sk-ant-… key.",
    status: "ready",
  },
  {
    slug: "openai",
    displayName: "OpenAI",
    type: "direct",
    blurb: "Direct OpenAI API. BYOK with your sk-… key.",
    status: "ready",
  },
  {
    slug: "google",
    displayName: "Gemini (Google)",
    type: "direct",
    blurb: "Direct Google Generative AI API. BYOK.",
    status: "ready",
  },

  // Coming soon — tracked under Workstream 5.
  {
    slug: "claude-code",
    displayName: "Claude Code (Anthropic CLI)",
    type: "harness",
    blurb: "Use your Claude Pro/Max subscription via the claude CLI, or BYOK.",
    status: "coming-soon",
  },
  {
    slug: "codex",
    displayName: "Codex (OpenAI CLI)",
    type: "harness",
    blurb: "OpenAI Codex coding-agent CLI.",
    status: "coming-soon",
  },
  {
    slug: "opencode",
    displayName: "OpenCode",
    type: "harness",
    blurb: "Open-source coding agent CLI.",
    status: "coming-soon",
  },
  {
    slug: "grok",
    displayName: "Grok (xAI)",
    type: "direct",
    blurb: "OpenAI-compatible REST API. BYOK.",
    status: "coming-soon",
  },
  {
    slug: "openrouter",
    displayName: "OpenRouter",
    type: "gateway",
    blurb: "Single key, 100+ models from many vendors.",
    status: "coming-soon",
  },
  {
    slug: "acp",
    displayName: "ACPX (ACP-compatible: Claude/Pi/Gemini)",
    type: "gateway",
    blurb: "Multiplexer over multiple model vendors via ACP.",
    status: "coming-soon",
  },
  {
    slug: "ollama",
    displayName: "Ollama (local)",
    type: "local",
    blurb: "Run Llama, Qwen, Mistral, Hermes locally. No API key.",
    status: "ready",
  },
];

export function providersByType(type: ProviderType): ProviderInfo[] {
  return PROVIDERS.filter((p) => p.type === type);
}
