import "server-only";
import { prisma } from "@octopus/db";
import { getProvider } from "./providers";
import type { AiCreateParams, AiProvider, AiResponse } from "./providers";

export type { AiCreateParams, AiMessage, AiProvider, AiResponse } from "./providers";

// ── Provider resolution ──────────────────────────────────────────────────────

const PROVIDER_FALLBACK: Record<string, AiProvider> = {
  claude: "anthropic",
  gpt: "openai",
  o1: "openai",
  o3: "openai",
  o4: "openai",
  codex: "openai",
  gemini: "google",
  "ollama:": "ollama", // namespaced models like "ollama:qwen2.5-coder:32b"
  "local:": "local",
  "grok-": "grok",
  "openrouter/": "openrouter", // OpenRouter uses vendor/model IDs (e.g. openai/gpt-4o)
  // ORDER MATTERS: longer prefix must come before its shorter sibling so the
  // `for…in startsWith` loop matches "mock-fail-…" against "mock-fail-"
  // before it falls through to "mock-". Object key insertion order is
  // iteration order in V8 — do not reorder these two without re-checking.
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
    anthropicApiKey: org?.anthropicApiKey ?? null,
    openaiApiKey: org?.openaiApiKey ?? null,
    googleApiKey: org?.googleApiKey ?? null,
    grokApiKey: org?.grokApiKey ?? null,
    openrouterApiKey: org?.openrouterApiKey ?? null,
  };
}

function getOrgKeyForProvider(keys: OrgKeys, provider: AiProvider): string | null {
  switch (provider) {
    case "anthropic": return keys.anthropicApiKey;
    case "openai": return keys.openaiApiKey;
    case "google": return keys.googleApiKey;
    case "grok": return keys.grokApiKey;
    case "openrouter": return keys.openrouterApiKey;
    // Ollama runs locally — no API key. The base URL override is read by
    // the provider itself from prisma; we just pass null here.
    case "ollama": return null;
    // The local-agent bridge dispatches to a developer laptop; it reads
    // org-level state from prisma directly inside provider.create(),
    // so no API key is needed here.
    case "local": return null;
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
