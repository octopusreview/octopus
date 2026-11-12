import "server-only";
import { observeAiRequest, completionEvidence, sdkRequestOptions } from "./request-evidence";
import OpenAI from "openai";
import type { Provider, AiCreateParams, AiResponse } from "./index";
import { alibabaBaseUrl, alibabaRequestShape } from "./alibaba-request";
import { stripLoneSurrogates } from "./sanitize";

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
    if (params.system) messages.push({ role: "system", content: stripLoneSurrogates(params.system) });
    for (const m of params.messages) messages.push({ role: m.role, content: stripLoneSurrogates(m.content) });

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
      // Omitted for models not known to accept it.
      ...(enableThinking === undefined ? {} : { enable_thinking: enableThinking }),
      // Token usage arrives in the last chunk of a stream only when asked for.
      stream_options: { include_usage: true },
    };

    // Streamed: a non-streamed request sends its response headers only once the whole answer is
    // ready, and the runtime stops waiting for headers after five minutes. Qwen with thinking
    // can take longer than that, so such a review could never finish.
    const response = await client.chat.completions
      .stream(observeAiRequest(params, "alibaba", body) as Parameters<OpenAI["chat"]["completions"]["stream"]>[0], sdkRequestOptions(params))
      .finalChatCompletion();
    if (!response.usage) console.warn("[alibaba] Streamed completion carried no token usage");

    const choice = response.choices[0];
    const text = choice?.message?.content ?? "";

    // With thinking on, hitting the completion cap during reasoning returns
    // finish_reason "length" and an empty answer (the budget went to
    // reasoning_content). Fail loudly instead of returning "" as a success.
    if (enableThinking && !text && choice?.finish_reason === "length") {
      throw new Error(
        `DashScope hit max_completion_tokens (${maxCompletionTokens}) while thinking and returned no answer; raise maxTokens or disable thinking`,
      );
    }

    return {
      text,
      completion: completionEvidence(choice?.finish_reason, ["stop"]),
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
