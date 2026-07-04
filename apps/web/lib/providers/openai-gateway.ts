import "server-only";
import OpenAI from "openai";
import type { AiCreateParams, AiResponse, AiProvider } from "./index";
import { validateProviderUrl } from "./url-validation";

/**
 * Shared implementation for OpenAI-compatible gateway providers (acp, opencode,
 * and future custom-endpoint providers). The base URL + bearer token can come
 * from env (deployment-trusted) OR from per-org configuration (org-admin
 * supplied), so the URL is SSRF-validated here — it rejects loopback / RFC1918
 * / link-local hosts in hosted mode so a malicious org admin can't point this
 * at cloud metadata or an internal VPC service. Self-hosted deployments opt in
 * via SELF_HOSTED=true.
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

export async function callOpenAiGateway(
  params: AiCreateParams,
  opts: GatewayCallOptions,
): Promise<AiResponse> {
  // Not cached across calls: with per-org config the base URL + token vary by
  // org, so a per-provider client singleton would leak one org's gateway/token
  // to another. validateProviderUrl also strips any path/query so the SDK
  // builds `<origin>/v1/chat/completions` cleanly.
  const baseURL = `${validateProviderUrl(opts.baseUrl)}/v1`;
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
