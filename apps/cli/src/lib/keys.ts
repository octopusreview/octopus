/**
 * Per-provider input hints for the BYOK step. Keeps the wizard helpful
 * without forcing the user to context-switch into a browser to figure out
 * what format their key takes or where to get one.
 */
export type KeyHint = {
  /** Placeholder text shown in the masked input. */
  placeholder: string;
  /** URL where the user creates a key for this provider. */
  dashboardUrl: string;
  /** Minimum sensible length — guards against pasted partial keys. */
  minLength: number;
  /** Whether the provider needs no key (local, harness-with-CLI-auth, etc.). */
  keyless?: boolean;
};

export const KEY_HINTS: Record<string, KeyHint> = {
  anthropic: {
    placeholder: "sk-ant-…",
    dashboardUrl: "https://console.anthropic.com/settings/keys",
    minLength: 20,
  },
  openai: {
    placeholder: "sk-…",
    dashboardUrl: "https://platform.openai.com/api-keys",
    minLength: 20,
  },
  google: {
    placeholder: "AIza…",
    dashboardUrl: "https://aistudio.google.com/app/apikey",
    minLength: 20,
  },
  grok: {
    placeholder: "xai-…",
    dashboardUrl: "https://console.x.ai",
    minLength: 20,
  },
  openrouter: {
    placeholder: "sk-or-…",
    dashboardUrl: "https://openrouter.ai/keys",
    minLength: 20,
  },
  // Harnesses where the CLI tool carries its own auth — no key needed
  // unless the user explicitly picks "API key mode."
  "claude-code": {
    placeholder: "(skip if claude CLI is already signed in)",
    dashboardUrl: "https://console.anthropic.com/settings/keys",
    minLength: 0,
    keyless: true,
  },
  codex: {
    placeholder: "(skip if codex CLI is already signed in)",
    dashboardUrl: "https://platform.openai.com/api-keys",
    minLength: 0,
    keyless: true,
  },
  opencode: {
    placeholder: "(varies — see docs)",
    dashboardUrl: "https://opencode.dev",
    minLength: 0,
    keyless: true,
  },
  acp: {
    placeholder: "(ACPX base URL credentials)",
    dashboardUrl: "https://github.com/anthropics/agent-communication-protocol",
    minLength: 0,
    keyless: true,
  },
  ollama: {
    placeholder: "(Ollama is local — no key required)",
    dashboardUrl: "https://ollama.com",
    minLength: 0,
    keyless: true,
  },
};

export function hintFor(provider: string): KeyHint {
  return (
    KEY_HINTS[provider] ?? {
      placeholder: "API key…",
      dashboardUrl: "",
      minLength: 8,
    }
  );
}
