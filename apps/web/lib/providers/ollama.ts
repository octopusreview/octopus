import "server-only";
import OpenAI from "openai";
import type { Provider, AiCreateParams, AiResponse } from "./index";

/**
 * Ollama exposes an OpenAI-compatible Chat Completions endpoint at
 * `<base>/v1/chat/completions`, so we reuse the OpenAI SDK with a custom
 * baseURL. Ollama ignores the API key but the SDK requires a non-empty value.
 *
 * Configured per deployment (operator-trusted) via env, matching the existing
 * `.env.example` keys:
 *   - OLLAMA_SERVER_URL            base URL (default http://localhost:11434)
 *   - OLLAMA_USERNAME / _PASSWORD  optional HTTP Basic auth for a proxied host
 *
 * Pricing is zero — Ollama runs on the operator's own infra; `ai-usage.ts`
 * treats `ollama` as a free provider (never bills the platform).
 */

const DEFAULT_BASE_URL = "http://localhost:11434";

/**
 * Parse + sanitize the operator-supplied base URL: require http(s) and reduce
 * to a clean origin (drops any path/query so the SDK doesn't build `/v1/v1`).
 * Throws on a malformed value so a typo'd OLLAMA_SERVER_URL fails loudly at
 * first use instead of producing confusing request errors. Private/loopback
 * hosts are intentionally allowed — this is a deployment-operator env var and
 * Ollama is normally reached at localhost or an internal host (no SSRF surface:
 * the value is not user-supplied).
 */
function normalizeServerUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`OLLAMA_SERVER_URL is not a valid URL: ${raw.slice(0, 80)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`OLLAMA_SERVER_URL must use http(s); got ${parsed.protocol}`);
  }
  return parsed.origin;
}

// Cached for the process lifetime: env vars are read once at first use, so a
// changed OLLAMA_SERVER_URL / credentials take effect on restart — same as the
// platform-key singletons in the other providers (anthropic/openai/grok/...).
let platformClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (platformClient) return platformClient;

  const base = normalizeServerUrl(process.env.OLLAMA_SERVER_URL?.trim() || DEFAULT_BASE_URL);
  const username = process.env.OLLAMA_USERNAME;
  const password = process.env.OLLAMA_PASSWORD ?? "";
  const defaultHeaders = username
    ? { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` }
    : undefined;

  platformClient = new OpenAI({
    apiKey: "ollama", // ignored by Ollama; the SDK just requires a non-empty value
    baseURL: `${base}/v1`,
    defaultHeaders,
  });
  return platformClient;
}

export const ollamaProvider: Provider = {
  name: "ollama",
  supportsJsonSchema: false, // Ollama can be asked for JSON but doesn't enforce a schema yet
  async create(params: AiCreateParams): Promise<AiResponse> {
    const client = getClient();

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (params.system) messages.push({ role: "system", content: params.system });
    for (const m of params.messages) messages.push({ role: m.role, content: m.content });

    // Octopus namespaces local models as "ollama:<model>"; strip the prefix.
    const model = params.model.startsWith("ollama:") ? params.model.slice(7) : params.model;

    const response = await client.chat.completions.create({
      model,
      max_completion_tokens: params.maxTokens,
      messages,
    });

    const text = response.choices[0]?.message?.content ?? "";

    return {
      text,
      provider: "ollama",
      model: params.model,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  },
};
