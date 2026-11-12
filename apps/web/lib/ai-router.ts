import "server-only";
import { AiProviderFailure, providerKeyOwner, providerRouteUnchanged } from "./provider-failure";
import { CapacityAdmissionError, capacityReceipt, refuseCapacity, withinReviewWindow, COMPLETE_REVIEW_POLICY } from "./review-capacity";
import { prisma } from "@octopus/db";
import { decryptStringMaybeLegacy } from "@/lib/crypto";
import { getProvider } from "./providers";
import type { AiCreateParams, AiProvider, AiResponse } from "./providers";
import { ALWAYS_THINKING_MODEL_RX } from "./providers/thinking";
import { getReviewEffort } from "./review-effort";

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
  "qwen3.8-max": "alibaba", // Alibaba Cloud Model Studio (DashScope), e.g. qwen3.8-max-0902
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

/**
 * Public wrapper over the internal provider resolver: maps a model id to the
 * LLM provider it routes to (DB cache → name-prefix fallback → "anthropic").
 * Used by the spend-limit gate to know which BYOK key exempts an org.
 */
export async function getProviderForModel(modelId: string): Promise<AiProvider> {
  return resolveProvider(modelId);
}

// ── Org key resolver ─────────────────────────────────────────────────────────

type OrgKeyField = "anthropicApiKey" | "openaiApiKey" | "googleApiKey" | "grokApiKey" | "openrouterApiKey" | "alibabaApiKey";
const PROVIDER_KEY_FIELDS: Record<AiProvider, OrgKeyField | null> = {
  anthropic: "anthropicApiKey", openai: "openaiApiKey", google: "googleApiKey", grok: "grokApiKey",
  openrouter: "openrouterApiKey", alibaba: "alibabaApiKey",
  ollama: null, local: null, acp: null, opencode: null, "claude-code": null, mock: null, "mock-fail": null,
};

async function getOrgKeyForProvider(orgId: string, provider: AiProvider): Promise<string | null> {
  const field = Object.hasOwn(PROVIDER_KEY_FIELDS, provider) ? PROVIDER_KEY_FIELDS[provider] : null;
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: field ? { [field]: true } : { id: true },
  });
  const value = field ? (org as Partial<Record<OrgKeyField, string | null>> | null)?.[field] : null;
  return value ? decryptStringMaybeLegacy(value) : null;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a message using the correct provider for the given model.
 * Automatically resolves provider from model ID and uses org-specific API keys.
 */
export async function createAiMessage(
  params: AiCreateParams,
  orgId: string,
  /** Prevents provider entry after cancellation; does not interrupt a provider already entered. */
  signal?: AbortSignal,
): Promise<AiResponse> {
  signal?.throwIfAborted();
  const admission = params.completeReviewAdmission;
  const window = admission?.window ?? params.executionWindow;
  const setup = async () => {
    const provider = await resolveProvider(params.model);
    if (admission && (provider !== "anthropic" || params.model !== COMPLETE_REVIEW_POLICY.model)) {
      refuseCapacity(admission, capacityReceipt(admission, params.model), "unsupported-route");
    }
    if (window && provider !== "anthropic") throw new Error("Measured review provider changed before recovery");
    const orgKey = await getOrgKeyForProvider(orgId, provider);

    // Only always-thinking text calls consume effort; an explicit effort wins.
    if (
      params.effort === undefined &&
      params.responseSchema === undefined &&
      ALWAYS_THINKING_MODEL_RX.test(params.model)
    ) {
      params = { ...params, effort: await getReviewEffort(orgId) };
    }
    return { provider, orgKey };
  };
  let route: Awaited<ReturnType<typeof setup>>;
  try {
    route = window ? await withinReviewWindow(window,
      window.remainingMs() - (admission ? COMPLETE_REVIEW_POLICY.minGenerationMs : 0) - COMPLETE_REVIEW_POLICY.publicationReserveMs, setup) : await setup();
  } catch (error) {
    if (error instanceof CapacityAdmissionError || !admission) throw error;
    refuseCapacity(admission, capacityReceipt(admission, params.model), "final-check-failed", error);
  }
  const { provider, orgKey } = route;
  if (admission) {
    params = { ...params, completeReviewAdmission: { ...admission, beforeGeneration: async signal => {
      const reason = await admission.beforeGeneration(signal);
      if (reason) return reason;
      // Billing must describe this already prepared client's payer. Never swap clients after counting.
      // Compare only in memory; credential material never enters the evidence or reviewer.
      const currentKey = await getOrgKeyForProvider(orgId, provider);
      signal.throwIfAborted();
      return currentKey === orgKey ? null : "credential-route-changed";
    } } };
  }

  signal?.throwIfAborted();
  params.signal?.throwIfAborted();
  try {
    const response = await getProvider(provider).create(params, orgKey, orgId);
    return window ? { ...response, usedOwnKey: !!orgKey } : response;
  } catch (error) {
    if (error instanceof CapacityAdmissionError) throw error;
    if (error instanceof AiProviderFailure) { failedRouteKeys.set(error, orgKey); throw error; }
    const failure = new AiProviderFailure(error, provider, params.model, providerKeyOwner(provider, !!orgKey));
    failedRouteKeys.set(failure, orgKey);
    console.error(`[ai-router] ${provider} API error:`, failure.details);
    throw failure;
  }
}

// Held in memory only, so a retry can prove it would use the same credential. Never logged or persisted.
const failedRouteKeys = new WeakMap<AiProviderFailure, string | null>();

/** True only when a retry of this failed request would use the same provider and the same credential. */
export async function credentialRouteUnchanged(failure: AiProviderFailure, orgId: string): Promise<boolean> {
  if (!failedRouteKeys.has(failure)) return false;
  const provider = await resolveProvider(failure.model);
  if (["claude-code", "acp", "opencode"].includes(provider)) return provider === failure.provider && await providerRouteUnchanged(failure, orgId);
  return provider === failure.provider && await getOrgKeyForProvider(orgId, provider) === failedRouteKeys.get(failure);
}

/**
 * Resolve the provider for a given model ID.
 */
export { resolveProvider };
