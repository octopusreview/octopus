import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "@octopus/db";
import { decryptStringMaybeLegacy } from "@/lib/crypto";

// ── Types ────────────────────────────────────────────────────────────────────

export type AiProvider = "anthropic" | "openai" | "google";

export type AiMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AiCreateParams = {
  model: string;
  maxTokens: number;
  system?: string;
  messages: AiMessage[];
  cacheSystem?: boolean;
};

export type AiResponse = {
  text: string;
  provider: AiProvider;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
};

// ── Provider resolution ──────────────────────────────────────────────────────

const PROVIDER_FALLBACK: Record<string, AiProvider> = {
  claude: "anthropic",
  gpt: "openai",
  o1: "openai",
  o3: "openai",
  o4: "openai",
  codex: "openai",
  gemini: "google",
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

// ── Client factories (singletons for platform keys) ──────────────────────────

let platformAnthropic: Anthropic | null = null;
let platformOpenAI: OpenAI | null = null;
let platformGoogle: GoogleGenerativeAI | null = null;

function getAnthropic(apiKey?: string | null): Anthropic {
  if (apiKey) return new Anthropic({ apiKey });
  if (!platformAnthropic) {
    platformAnthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return platformAnthropic;
}

function getOpenAI(apiKey?: string | null): OpenAI {
  if (apiKey) return new OpenAI({ apiKey });
  if (!platformOpenAI) {
    platformOpenAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  }
  return platformOpenAI;
}

function getGoogle(apiKey?: string | null): GoogleGenerativeAI {
  if (apiKey) return new GoogleGenerativeAI(apiKey);
  if (!platformGoogle) {
    platformGoogle = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  }
  return platformGoogle;
}

// ── Org key resolver ─────────────────────────────────────────────────────────

type OrgKeys = {
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  googleApiKey: string | null;
};

async function getOrgKeys(orgId: string): Promise<OrgKeys> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { anthropicApiKey: true, openaiApiKey: true, googleApiKey: true },
  });
  return {
    anthropicApiKey: org?.anthropicApiKey ? decryptStringMaybeLegacy(org.anthropicApiKey) : null,
    openaiApiKey: org?.openaiApiKey ? decryptStringMaybeLegacy(org.openaiApiKey) : null,
    googleApiKey: org?.googleApiKey ? decryptStringMaybeLegacy(org.googleApiKey) : null,
  };
}

function getOrgKeyForProvider(keys: OrgKeys, provider: AiProvider): string | null {
  switch (provider) {
    case "anthropic": return keys.anthropicApiKey;
    case "openai": return keys.openaiApiKey;
    case "google": return keys.googleApiKey;
  }
}

// ── Provider-specific call implementations ───────────────────────────────────

async function callAnthropic(
  params: AiCreateParams,
  apiKey?: string | null,
): Promise<AiResponse> {
  const client = getAnthropic(apiKey);

  const response = await client.messages.create({
    model: params.model,
    max_tokens: params.maxTokens,
    system: params.system
      ? [
          {
            type: "text" as const,
            text: params.system,
            ...(params.cacheSystem
              ? { cache_control: { type: "ephemeral" as const } }
              : {}),
          },
        ]
      : undefined,
    messages: params.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  return {
    text,
    provider: "anthropic",
    model: params.model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

// Codex / agentic coding models (e.g. gpt-5.3-codex) are served only via the
// Responses API; chat.completions returns 404 "not a chat model".
function usesResponsesApi(model: string): boolean {
  return model.includes("codex");
}

async function callOpenAI(
  params: AiCreateParams,
  apiKey?: string | null,
): Promise<AiResponse> {
  const client = getOpenAI(apiKey);

  if (usesResponsesApi(params.model)) {
    return callOpenAIResponses(client, params);
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (params.system) {
    messages.push({ role: "system", content: params.system });
  }
  for (const m of params.messages) {
    messages.push({ role: m.role, content: m.content });
  }

  const response = await client.chat.completions.create({
    model: params.model,
    max_completion_tokens: params.maxTokens,
    messages,
  });

  const text = response.choices[0]?.message?.content ?? "";

  return {
    text,
    provider: "openai",
    model: params.model,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      cacheReadTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: 0,
    },
  };
}

async function callOpenAIResponses(
  client: OpenAI,
  params: AiCreateParams,
): Promise<AiResponse> {
  const response = await client.responses.create({
    model: params.model,
    instructions: params.system,
    input: params.messages.map((m) => ({ role: m.role, content: m.content })),
    max_output_tokens: params.maxTokens,
  });

  return {
    text: response.output_text ?? "",
    provider: "openai",
    model: params.model,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cacheReadTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: 0,
    },
  };
}

async function callGoogle(
  params: AiCreateParams,
  apiKey?: string | null,
): Promise<AiResponse> {
  const genAI = getGoogle(apiKey);
  const model = genAI.getGenerativeModel({ model: params.model });

  const contents = params.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const result = await model.generateContent({
    contents,
    systemInstruction: params.system ? { role: "user", parts: [{ text: params.system }] } : undefined,
    generationConfig: { maxOutputTokens: params.maxTokens },
  });

  const response = result.response;
  const text = response.text();
  const usage = response.usageMetadata;

  return {
    text,
    provider: "google",
    model: params.model,
    usage: {
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  };
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
    switch (provider) {
      case "anthropic":
        return await callAnthropic(params, orgKey);
      case "openai":
        return await callOpenAI(params, orgKey);
      case "google":
        return await callGoogle(params, orgKey);
    }
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
