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

export async function callOpenAiGateway(
  params: AiCreateParams,
  opts: GatewayCallOptions,
): Promise<AiResponse> {
  const baseURL = `${normalizeGatewayUrl(opts.baseUrl, opts.name)}/v1`;
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL });

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
