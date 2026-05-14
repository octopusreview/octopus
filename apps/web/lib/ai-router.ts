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
// In Databricks mode, every provider talks to the workspace's **AI Gateway**
// (a Databricks-managed proxy that handles routing + governance). The Gateway
// exposes provider-native APIs at:
//   ${host}/ai-gateway/anthropic     (Anthropic Messages API — preserves cache_control)
//   ${host}/ai-gateway/openai/v1     (OpenAI-compatible chat + embeddings)
//   ${host}/ai-gateway/google        (Gemini, if a key was generated)
//
// Authentication is a single workspace-scoped Gateway API key (DAPI token)
// generated from the Databricks UI (Compute → External Agents → Generate API Key).
// One key works across all providers. The `apiKey` BYOK parameter is ignored.

function getGatewayToken(): string {
  const tok = process.env.DATABRICKS_GATEWAY_TOKEN;
  if (!tok) {
    throw new Error(
      "DATABRICKS_GATEWAY_TOKEN is missing — generate one in Databricks UI " +
        "(Compute → External Agents → Other Integrations → Generate API Key) " +
        "and push it to the octopus-octopus-ai secret scope.",
    );
  }
  return tok;
}

/**
 * Databricks AI Gateway uses its own model identifiers (`databricks-claude-*`,
 * `databricks-gpt-*`, etc.) rather than Anthropic / OpenAI native model IDs.
 * Translate the model string the app uses internally (e.g.
 * `claude-sonnet-4-6-20250619`) to the Gateway's identifier.
 *
 * Available on this workspace (probed 2026-05-14):
 *   Anthropic: databricks-claude-{haiku-4-5, opus-4-1, opus-4-5, opus-4-6,
 *              opus-4-7, sonnet-4, sonnet-4-5, sonnet-4-6}
 *   OpenAI:    databricks-gpt-5, databricks-gpt-5-{4, 5, mini, nano}
 *   Embedding: databricks-gte-large-en (1024 dim)
 */
function translateModelForGateway(model: string, provider: AiProvider): string {
  // If already namespaced for the gateway, pass through.
  if (model.startsWith("databricks-")) return model;

  if (provider === "anthropic") {
    // claude-sonnet-4-6-20250619 → databricks-claude-sonnet-4-6
    // Strip a trailing date suffix (-YYYYMMDD) and prepend `databricks-`.
    const stripped = model.replace(/-\d{8}$/, "");
    // Map opus-4 (no minor) onto opus-4-1 (the gateway's earliest opus-4 build).
    if (stripped === "claude-opus-4") return "databricks-claude-opus-4-1";
    return `databricks-${stripped}`;
  }

  if (provider === "openai") {
    // OpenAI: gateway only exposes the gpt-5 family + variants. Map common
    // legacy names onto sensible defaults so older configs keep working.
    if (/^(o3|o4|gpt-4o|gpt-4-1|codex)/i.test(model)) return "databricks-gpt-5-mini";
    if (/^gpt-5/i.test(model)) return `databricks-${model.replace(/-\d{8}$/, "")}`;
    return "databricks-gpt-5-mini";
  }

  if (provider === "google") {
    // No Gemini route configured yet — caller must add one via the UI before
    // this branch resolves. Pass through for now; callGoogle surfaces the
    // gateway's "endpoint does not exist" error which is more actionable than
    // a guessed translation.
    return model;
  }

  return model;
}

async function getAnthropic(apiKey?: string | null): Promise<Anthropic> {
  if (dbxConfig.isDatabricksRuntime) {
    return new Anthropic({
      authToken: getGatewayToken(),
      baseURL: `${dbxConfig.host}/ai-gateway/anthropic`,
    });
  }
  if (apiKey) return new Anthropic({ apiKey });
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

async function getOpenAI(apiKey?: string | null): Promise<OpenAI> {
  if (dbxConfig.isDatabricksRuntime) {
    return new OpenAI({
      apiKey: getGatewayToken(),
      baseURL: `${dbxConfig.host}/ai-gateway/openai/v1`,
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
  const wireModel = dbxConfig.isDatabricksRuntime
    ? translateModelForGateway(params.model, "anthropic")
    : params.model;

  const response = await client.messages.create({
    model: wireModel,
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
  const wireModel = dbxConfig.isDatabricksRuntime
    ? translateModelForGateway(params.model, "openai")
    : params.model;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (params.system) {
    messages.push({ role: "system", content: params.system });
  }
  for (const m of params.messages) {
    messages.push({ role: m.role, content: m.content });
  }

  const response = await client.chat.completions.create({
    model: wireModel,
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
    const token = getGatewayToken();
    const messages: Array<{ role: string; content: string }> = [];
    if (params.system) messages.push({ role: "system", content: params.system });
    for (const m of params.messages) messages.push({ role: m.role, content: m.content });

    // AI Gateway exposes Gemini at /ai-gateway/google with OpenAI-compatible
    // chat-completions format. Generate the key in the Databricks UI under
    // Compute → External Agents → Gemini → Generate API Key.
    const wireModel = translateModelForGateway(params.model, "google");
    const r = await fetch(`${dbxConfig.host}/ai-gateway/google/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: wireModel,
        messages,
        max_tokens: params.maxTokens,
      }),
    });
    if (!r.ok) {
      throw new Error(`Gemini via AI Gateway ${r.status}: ${await r.text().catch(() => "")}`);
    }
    const json = (await r.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

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
