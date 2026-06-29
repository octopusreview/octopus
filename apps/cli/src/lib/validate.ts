import { loadByok } from "./byok.js";
import { loadConfig, DEFAULT_OLLAMA_BASE_URL } from "./config.js";

/**
 * Validate that a BYOK key actually works against the provider's API.
 * Each provider has a different cheapest-possible check:
 *
 *   anthropic  → GET /v1/models
 *   openai     → GET /v1/models
 *   google     → GET /v1beta/models?key=…
 *   grok       → GET /v1/models (OpenAI-compatible at https://api.x.ai/v1)
 *   openrouter → GET /api/v1/models (no auth even, but we send the key for sanity)
 *   ollama     → GET http://localhost:11434/api/tags (local; no key needed)
 *
 * For providers without a built-in validation path (acp / codex / opencode /
 * claude-code) the result is `skipped` — the user gets a "validation isn't
 * implemented for this provider yet" message and proceeds.
 */
export type ValidateResult =
  | { ok: true; modelCount?: number }
  | { ok: false; status: number; message: string }
  | { ok: "skipped"; reason: string };

export async function validateProvider(provider: string): Promise<ValidateResult> {
  const byok = await loadByok();
  const key = byok.keys[provider];

  switch (provider) {
    case "anthropic":
      return await validateAnthropic(key);
    case "openai":
      return await validateOpenAi("https://api.openai.com/v1/models", key);
    case "grok":
      return await validateOpenAi("https://api.x.ai/v1/models", key);
    case "openrouter":
      return await validateOpenAi("https://openrouter.ai/api/v1/models", key);
    case "google":
      return await validateGoogle(key);
    case "ollama":
      return await validateOllama();
    default:
      return { ok: "skipped", reason: `Validation for "${provider}" is not implemented yet.` };
  }
}

async function validateAnthropic(key: string | undefined): Promise<ValidateResult> {
  if (!key) return { ok: "skipped", reason: "No API key saved." };
  try {
    const r = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    });
    if (!r.ok) return { ok: false, status: r.status, message: await shortBody(r) };
    const data = (await r.json()) as { data?: unknown[] };
    return { ok: true, modelCount: data.data?.length };
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : String(e) };
  }
}

async function validateOpenAi(url: string, key: string | undefined): Promise<ValidateResult> {
  if (!key) return { ok: "skipped", reason: "No API key saved." };
  try {
    const r = await fetch(url, { headers: { authorization: `Bearer ${key}` } });
    if (!r.ok) return { ok: false, status: r.status, message: await shortBody(r) };
    const data = (await r.json()) as { data?: unknown[] };
    return { ok: true, modelCount: data.data?.length };
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : String(e) };
  }
}

async function validateGoogle(key: string | undefined): Promise<ValidateResult> {
  if (!key) return { ok: "skipped", reason: "No API key saved." };
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
    );
    if (!r.ok) return { ok: false, status: r.status, message: await shortBody(r) };
    const data = (await r.json()) as { models?: unknown[] };
    return { ok: true, modelCount: data.models?.length };
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : String(e) };
  }
}

async function validateOllama(): Promise<ValidateResult> {
  // URL precedence (matches config.ts:20-28 + agent-serve.ts:79-80):
  //   1. OLLAMA_BASE_URL env (wins)
  //   2. ollamaBaseUrl in ~/.octopus/config.json (set by the wizard)
  //   3. Built-in default
  // The previous version skipped step 2, so a user who pointed the wizard
  // at a non-default Ollama URL got `validate` and `doctor` probing
  // localhost — `octp doctor` then printed a hard ✗ error even though
  // `octp agent serve` worked fine against the configured URL.
  const config = await loadConfig();
  const base =
    process.env.OLLAMA_BASE_URL ?? config.ollamaBaseUrl ?? DEFAULT_OLLAMA_BASE_URL;
  try {
    const r = await fetch(`${base}/api/tags`);
    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
        message:
          `Ollama responded ${r.status}. Is it running? Try \`ollama serve\` in another terminal.`,
      };
    }
    const data = (await r.json()) as { models?: unknown[] };
    return { ok: true, modelCount: data.models?.length };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      message: `Could not reach Ollama at ${base}. Try \`ollama serve\`. (${e instanceof Error ? e.message : String(e)})`,
    };
  }
}

async function shortBody(r: Response): Promise<string> {
  try {
    const text = (await r.text()).trim();
    return text.slice(0, 200);
  } catch {
    return `HTTP ${r.status}`;
  }
}
