import "server-only";
import OpenAI from "openai";
import type { AiCreateParams, AiResponse, AiProvider } from "./index";
import { validateProviderUrl } from "./url-validation";

/**
 * Shared implementation for OpenAI-compatible gateway providers (acp,
 * opencode, and future custom-endpoint providers). The previous per-provider
 * copies of this logic in `acp.ts` and `opencode.ts` were 95% identical and
 * each one needed to be updated whenever the request shape evolved.
 *
 * Caller supplies:
 *   - `name`        — provider name for AiResponse.provider
 *   - `modelPrefix` — namespace prefix to strip from `params.model`
 *     (e.g. "acp:" or "opencode:")
 *   - `baseUrl`     — gateway origin (already resolved from per-org config
 *     or env). Will be passed through `validateProviderUrl` first to prevent
 *     SSRF against cloud metadata endpoints / internal services / etc.
 *   - `apiKey`      — bearer token for the gateway
 *
 * Returns the standard AiResponse shape with usage tokens extracted from
 * the OpenAI-format response. Cache-read tokens are forwarded when the
 * gateway reports them; cache-write is always 0 (gateways generally don't
 * surface this).
 */
export type GatewayCallOptions = {
  name: AiProvider;
  modelPrefix: string;
  baseUrl: string;
  apiKey: string;
};

export async function callOpenAiGateway(
  params: AiCreateParams,
  opts: GatewayCallOptions,
): Promise<AiResponse> {
  // SSRF guard — validateProviderUrl rejects loopback/RFC1918/link-local in
  // hosted mode so a malicious org admin can't point this at AWS metadata
  // or our internal VPC. Self-hosted deployments opt in via SELF_HOSTED=true.
  const safeBase = validateProviderUrl(opts.baseUrl);

  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: `${safeBase}/v1` });

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
