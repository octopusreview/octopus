import "server-only";
import { prisma } from "@octopus/db";
import { decryptStringMaybeLegacy } from "@/lib/crypto";
import { getProvider } from "./providers";
import type { AiCreateParams, AiProvider, AiResponse } from "./providers";

export type { AiCreateParams, AiMessage, AiProvider, AiResponse } from "./providers";

// ── Provider resolution ──────────────────────────────────────────────────────

const PROVIDER_FALLBACK: Record<string, AiProvider> = {
  // "claude-code:" MUST precede "claude" — both match a "claude-code:…" model
  // and "claude" would otherwise win, mis-routing it to the anthropic provider
  // with a literal "claude-code:…" model string the Anthropic API rejects.
  "claude-code:": "claude-code",
  // Local-agent bridge: "local:<model>" dispatches to a developer laptop.
  "local:": "local",
  claude: "anthropic",
  gpt: "openai",
  o1: "openai",
  o3: "openai",
  o4: "openai",
  codex: "openai",
  gemini: "google",
  "grok-": "grok",
  // Explicit "openrouter/…"-namespaced model id forces OpenRouter routing.
  // Native OpenRouter ids are vendor/model (e.g. "openai/gpt-4o") and resolve
  // via the AvailableModel DB cache above, not this prefix.
  "openrouter/": "openrouter",
  "ollama:": "ollama", // namespaced local models, e.g. "ollama:qwen2.5-coder:32b"
  "acp:": "acp", // OpenAI-compatible gateway (Agent Communication Protocol)
  "opencode:": "opencode", // OpenAI-compatible gateway
  // "mock-fail-" MUST precede "mock-" (both match a "mock-fail-…" id). Test
  // doubles only — never registered in production (see providers/index.ts).
  "mock-fail-": "mock-fail",
  "mock-": "mock",
};

let providerCache: Map<string, AiProvider> | null = null;
let providerCacheTime = 0;
let cacheRefreshPromise: Promise<void> | null = null;
const PROVIDER_CACHE_TTL = 5 * 60 * 1000;

async function refreshProviderCache(): Promise<void> {
  const models = await prisma.availableModel.findMany({
    select: { modelId: true, provider: true },
  });
  providerCache = new Map();
  for (const m of models) {
    providerCache.set(m.modelId, m.provider as AiProvider);
  }
  providerCacheTime = Date.now();
}

async function resolveProvider(modelId: string): Promise<AiProvider> {
  // Check DB cache — dedup concurrent refreshes
  if (!providerCache || Date.now() - providerCacheTime > PROVIDER_CACHE_TTL) {
    if (!cacheRefreshPromise) {
      cacheRefreshPromise = refreshProviderCache().finally(() => {
        cacheRefreshPromise = null;
      });
    }
    await cacheRefreshPromise;
  }

  const cached = providerCache?.get(modelId);
  if (cached) return cached;

  // Fallback: infer from model name prefix
  for (const [prefix, provider] of Object.entries(PROVIDER_FALLBACK)) {
    if (modelId.startsWith(prefix)) return provider;
  }

  return "anthropic"; // default
}

// ── Org key resolver ─────────────────────────────────────────────────────────

type OrgKeys = {
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  googleApiKey: string | null;
  grokApiKey: string | null;
  openrouterApiKey: string | null;
};

async function getOrgKeys(orgId: string): Promise<OrgKeys> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      anthropicApiKey: true,
      openaiApiKey: true,
      googleApiKey: true,
      grokApiKey: true,
      openrouterApiKey: true,
    },
  });
  return {
    anthropicApiKey: org?.anthropicApiKey ? decryptStringMaybeLegacy(org.anthropicApiKey) : null,
    openaiApiKey: org?.openaiApiKey ? decryptStringMaybeLegacy(org.openaiApiKey) : null,
    googleApiKey: org?.googleApiKey ? decryptStringMaybeLegacy(org.googleApiKey) : null,
    grokApiKey: org?.grokApiKey ? decryptStringMaybeLegacy(org.grokApiKey) : null,
    openrouterApiKey: org?.openrouterApiKey ? decryptStringMaybeLegacy(org.openrouterApiKey) : null,
  };
}

function getOrgKeyForProvider(keys: OrgKeys, provider: AiProvider): string | null {
  switch (provider) {
    case "anthropic": return keys.anthropicApiKey;
    case "openai": return keys.openaiApiKey;
    case "google": return keys.googleApiKey;
    case "grok": return keys.grokApiKey;
    case "openrouter": return keys.openrouterApiKey;
    // Ollama runs on the operator's own infra — env-configured, no per-org key.
    case "ollama": return null;
    // Local-agent bridge dispatches to a laptop; provider.create() reads org
    // state from prisma directly, so no key here.
    case "local": return null;
    // ACPX / OpenCode are operator-configured gateways (env base URL + token,
    // resolved inside the provider). Claude Code reads its config (mode + key)
    // from prisma inside provider.create(). No per-org key here.
    case "acp":
    case "opencode":
    case "claude-code":
      return null;
    // Test doubles take no key.
    case "mock":
    case "mock-fail":
      return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a message using the correct provider for the given model.
 * Automatically resolves provider from model ID and uses org-specific API keys.
 */
export async function createAiMessage(
  params: AiCreateParams,
  orgId: string,
): Promise<AiResponse> {
  const provider = await resolveProvider(params.model);
  const keys = await getOrgKeys(orgId);
  const orgKey = getOrgKeyForProvider(keys, provider);

  try {
    return await getProvider(provider).create(params, orgKey, orgId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ai-router] ${provider} API error for model ${params.model}:`, message);
    throw new Error(`AI provider ${provider} failed: ${message}`);
  }
}

/**
 * Resolve the provider for a given model ID.
 */
export { resolveProvider };
