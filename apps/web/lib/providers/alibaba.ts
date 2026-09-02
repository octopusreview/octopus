import "server-only";
import OpenAI from "openai";
import type { Provider, AiCreateParams, AiResponse } from "./index";
import { alibabaBaseUrl, alibabaRequestShape } from "./alibaba-request";

/**
 * Alibaba Cloud Model Studio (DashScope). OpenAI-compatible REST at
 * `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` (override with
 * DASHSCOPE_BASE_URL, e.g. the China endpoint) — reuse the OpenAI SDK with a
 * custom baseURL. The org BYOK key is resolved + decrypted by the ai-router
 * facade and passed in as `apiKey`. Keys are region-scoped: an international
 * key does not work against the China endpoint and vice versa.
 */
let platformClient: OpenAI | null = null;

function getClient(apiKey?: string | null): OpenAI {
  const baseURL = alibabaBaseUrl();
  if (apiKey) return new OpenAI({ apiKey, baseURL });
  if (!platformClient) {
    platformClient = new OpenAI({
      apiKey: process.env.DASHSCOPE_API_KEY ?? "",
      baseURL,
    });
  }
  return platformClient;
}

export const alibabaProvider: Provider = {
  name: "alibaba",
  // The Qwen3.8-Max family supports response_format json_schema (strict).
  supportsJsonSchema: true,
  async create(params: AiCreateParams, apiKey?: string | null): Promise<AiResponse> {
    const client = getClient(apiKey);

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (params.system) messages.push({ role: "system", content: params.system });
    for (const m of params.messages) messages.push({ role: m.role, content: m.content });

    const { maxCompletionTokens, enableThinking } = alibabaRequestShape(params);

    const body = {
      model: params.model,
      // DashScope recommends max_completion_tokens (caps thinking + answer);
      // max_tokens is deprecated there.
      max_completion_tokens: maxCompletionTokens,
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
      // Vendor extension (not in the OpenAI SDK types); serialized as-is.
      enable_thinking: enableThinking,
    };

    const response = await client.chat.completions.create(
      body as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    );

    const text = response.choices[0]?.message?.content ?? "";

    return {
      text,
      provider: "alibaba",
      model: params.model,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        // completion_tokens includes reasoning tokens (billed as output).
        outputTokens: response.usage?.completion_tokens ?? 0,
        cacheReadTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: 0,
      },
    };
  },
};
