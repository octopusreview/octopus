import "server-only";
import OpenAI from "openai";
import type { Provider, AiCreateParams, AiResponse } from "./index";

/**
 * OpenRouter. Gateway to many models from many vendors via a single API key.
 * OpenAI-compatible at `https://openrouter.ai/api/v1`. Model IDs are
 * namespaced (`openai/gpt-4o`, `anthropic/claude-sonnet-4-6`, …).
 *
 * The HTTP-Referer + X-Title headers are recommended by OpenRouter for
 * attribution / rate-limit fairness; they're not enforced but they're free.
 * The org BYOK key is resolved + decrypted by the ai-router facade.
 */
const BASE_URL = "https://openrouter.ai/api/v1";

let platformClient: OpenAI | null = null;

function getClient(apiKey?: string | null): OpenAI {
  const headers = {
    "HTTP-Referer": "https://octopus-review.ai",
    "X-Title": "Octopus",
  };
  if (apiKey) return new OpenAI({ apiKey, baseURL: BASE_URL, defaultHeaders: headers });
  if (!platformClient) {
    platformClient = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
      baseURL: BASE_URL,
      defaultHeaders: headers,
    });
  }
  return platformClient;
}

export const openrouterProvider: Provider = {
  name: "openrouter",
  supportsJsonSchema: true,
  async create(params: AiCreateParams, apiKey?: string | null): Promise<AiResponse> {
    const client = getClient(apiKey);

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (params.system) messages.push({ role: "system", content: params.system });
    for (const m of params.messages) messages.push({ role: m.role, content: m.content });

    const response = await client.chat.completions.create({
      model: params.model,
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
      provider: "openrouter",
      model: params.model,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        cacheReadTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: 0,
      },
    };
  },
};
