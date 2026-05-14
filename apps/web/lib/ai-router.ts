import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { prisma } from "@octopus/db";
import { config as dbxConfig } from "@/lib/databricks/config";
import { getWorkspaceToken } from "@/lib/databricks/oauth";
import { dbxFetch } from "@/lib/databricks/rest";

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

  for (const [prefix, provider] of Object.entries(PROVIDER_FALLBACK)) {
    if (modelId.startsWith(prefix)) return provider;
  }

  return "anthropic"; // default
}

// ── Client factories ────────────────────────────────────────────────────────
//
// In Databricks mode, every provider talks to the workspace-hosted AI Gateway
// endpoint (Anthropic-native for Claude — preserves `cache_control`; OpenAI
// chat-completions for OpenAI; Gemini via raw fetch to OpenAI-compatible
// endpoint). The `apiKey` parameter (legacy BYOK) is ignored on Databricks —
// per-org keys are not threaded through the gateway in this deployment.

async function getAnthropic(apiKey?: string | null): Promise<Anthropic> {
  if (dbxConfig.isDatabricksRuntime) {
    const token = await getWorkspaceToken();
    return new Anthropic({
      authToken: token,
      baseURL: `${dbxConfig.host}/serving-endpoints/${dbxConfig.anthropicEndpoint}/`,
    });
  }
  if (apiKey) return new Anthropic({ apiKey });
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

async function getOpenAI(apiKey?: string | null): Promise<OpenAI> {
  if (dbxConfig.isDatabricksRuntime) {
    const token = await getWorkspaceToken();
    return new OpenAI({
      apiKey: token,
      baseURL: `${dbxConfig.host}/serving-endpoints/${dbxConfig.openaiEndpoint}/v1`,
    });
  }
  if (apiKey) return new OpenAI({ apiKey });
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
}

// ── Org key resolver ─────────────────────────────────────────────────────────
// Kept for the local-dev path; ignored in Databricks deployment.

type OrgKeys = {
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  googleApiKey: string | null;
};

async function getOrgKeys(orgId: string): Promise<OrgKeys> {
  // Skip the DB roundtrip when the platform is going to ignore the result anyway.
  if (dbxConfig.isDatabricksRuntime) {
    return { anthropicApiKey: null, openaiApiKey: null, googleApiKey: null };
  }
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { anthropicApiKey: true, openaiApiKey: true, googleApiKey: true },
  });
  return {
    anthropicApiKey: org?.anthropicApiKey ?? null,
    openaiApiKey: org?.openaiApiKey ?? null,
    googleApiKey: org?.googleApiKey ?? null,
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
  const client = await getAnthropic(apiKey);

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

async function callOpenAI(
  params: AiCreateParams,
  apiKey?: string | null,
): Promise<AiResponse> {
  const client = await getOpenAI(apiKey);

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

// Gemini — through Databricks AI Gateway in production. The Google SDK doesn't
// accept a custom baseURL, so we call AI Gateway's OpenAI-compatible interface
// directly via fetch. In local dev (no DATABRICKS_HOST), fall back to the
// @google/generative-ai SDK against the public Gemini API.
async function callGoogle(
  params: AiCreateParams,
  apiKey?: string | null,
): Promise<AiResponse> {
  if (dbxConfig.isDatabricksRuntime) {
    const messages: Array<{ role: string; content: string }> = [];
    if (params.system) messages.push({ role: "system", content: params.system });
    for (const m of params.messages) messages.push({ role: m.role, content: m.content });

    const body = {
      model: params.model,
      messages,
      max_tokens: params.maxTokens,
    };

    const json = await dbxFetch<{
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    }>(
      `/serving-endpoints/${dbxConfig.geminiEndpoint}/invocations`,
      { method: "POST", body: JSON.stringify(body) },
    );

    const text = json.choices?.[0]?.message?.content ?? "";
    return {
      text,
      provider: "google",
      model: params.model,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  }

  // Local dev path — lazy-import the SDK so the production build doesn't pull it in.
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(apiKey ?? process.env.GOOGLE_API_KEY!);
  const model = genAI.getGenerativeModel({ model: params.model });

  const contents = params.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const result = await model.generateContent({
    contents,
    systemInstruction: params.system
      ? { role: "user", parts: [{ text: params.system }] }
      : undefined,
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
 * On Databricks, all three providers route through AI Gateway endpoints.
 * Org-specific BYOK keys are only honoured in local dev.
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
