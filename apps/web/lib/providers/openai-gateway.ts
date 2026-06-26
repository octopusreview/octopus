import "server-only";
import OpenAI from "openai";
import type { AiCreateParams, AiResponse, AiProvider } from "./index";

/**
 * Shared implementation for OpenAI-compatible gateway providers (acp, opencode,
 * and future custom-endpoint providers). These point at an operator-supplied
 * gateway (base URL + bearer token from env), so the endpoint is
 * deployment-trusted — no SSRF attacker surface. We still parse the URL and
 * require http(s) so a typo'd env value fails loudly at first use.
 *
 * Caller supplies the provider name, the model-id namespace prefix to strip
 * (e.g. "acp:"), the gateway base URL, and the bearer token.
 */
export type GatewayCallOptions = {
  name: AiProvider;
  modelPrefix: string;
  baseUrl: string;
  apiKey: string;
};

function normalizeGatewayUrl(raw: string, providerName: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${providerName} base URL is not a valid URL: ${raw.slice(0, 80)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${providerName} base URL must use http(s); got ${parsed.protocol}`);
  }
  // Reduce to origin so the SDK builds `<origin>/v1/chat/completions` cleanly.
  return parsed.origin;
}

// Cache one OpenAI client per provider. The gateway base URL + token come from
// env (fixed for the process lifetime), so a single client per provider reuses
// connections across calls instead of constructing a new one every request —
// matching the singleton pattern in the other providers.
const clientCache = new Map<AiProvider, OpenAI>();

function getGatewayClient(opts: GatewayCallOptions): OpenAI {
  const cached = clientCache.get(opts.name);
  if (cached) return cached;
  const baseURL = `${normalizeGatewayUrl(opts.baseUrl, opts.name)}/v1`;
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL });
  clientCache.set(opts.name, client);
  return client;
}

export async function callOpenAiGateway(
  params: AiCreateParams,
  opts: GatewayCallOptions,
): Promise<AiResponse> {
  const client = getGatewayClient(opts);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (params.system) messages.push({ role: "system", content: params.system });
  for (const m of params.messages) messages.push({ role: m.role, content: m.content });

  const model = params.model.startsWith(opts.modelPrefix)
    ? params.model.slice(opts.modelPrefix.length)
    : params.model;

  const response = await client.chat.completions.create({
    model,
    max_completion_tokens: params.maxTokens,
    messages,
    ...(params.responseSchema
      ? {
          response_format: {
            type: "json_schema" as const,
            json_schema: {
              name: params.responseSchema.name,
              schema: params.responseSchema.schema,
              strict: true,
            },
          },
        }
      : {}),
  });

  const text = response.choices[0]?.message?.content ?? "";
  // Surface an empty completion as an error instead of returning a blank review
  // that downstream code would post as an empty PR comment.
  if (!text) {
    throw new Error(
      `${opts.name} gateway returned no text (finish_reason: ${response.choices[0]?.finish_reason ?? "unknown"})`,
    );
  }

  return {
    text,
    provider: opts.name,
    model: params.model,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      cacheReadTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: 0,
    },
  };
}
