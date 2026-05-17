import "server-only";
import OpenAI from "openai";
import type { Provider, AiCreateParams, AiResponse } from "./index";

let platformClient: OpenAI | null = null;

function getClient(apiKey?: string | null): OpenAI {
  if (apiKey) return new OpenAI({ apiKey });
  if (!platformClient) {
    platformClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  }
  return platformClient;
}

export const openaiProvider: Provider = {
  name: "openai",
  supportsJsonSchema: true,
  async create(params: AiCreateParams, apiKey?: string | null): Promise<AiResponse> {
    const client = getClient(apiKey);

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
      provider: "openai",
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
