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

// Codex / agentic coding models (e.g. gpt-5.3-codex) are served only via the
// Responses API; chat.completions returns 404 "not a chat model".
function usesResponsesApi(model: string): boolean {
  return model.includes("codex");
}

async function callOpenAIResponses(
  client: OpenAI,
  params: AiCreateParams,
): Promise<AiResponse> {
  const response = await client.responses.create({
    model: params.model,
    instructions: params.system,
    input: params.messages.map((m) => ({ role: m.role, content: m.content })),
    max_output_tokens: params.maxTokens,
    ...(params.responseSchema
      ? {
          text: {
            format: {
              type: "json_schema" as const,
              name: params.responseSchema.name,
              schema: params.responseSchema.schema,
              strict: true,
            },
          },
        }
      : {}),
  });

  const text = response.output_text ?? "";
  // Surface non-text or truncated responses as errors instead of silently
  // returning an empty review (e.g. status "incomplete" when max_output_tokens
  // is hit, or a refusal/non-text output item).
  if (!text) {
    const reason = response.incomplete_details?.reason;
    throw new Error(
      `OpenAI Responses returned no text (status: ${response.status}${reason ? `, reason: ${reason}` : ""})`,
    );
  }

  return {
    text,
    provider: "openai",
    model: params.model,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cacheReadTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: 0,
    },
  };
}

export const openaiProvider: Provider = {
  name: "openai",
  supportsJsonSchema: true,
  async create(params: AiCreateParams, apiKey?: string | null): Promise<AiResponse> {
    const client = getClient(apiKey);

    if (usesResponsesApi(params.model)) {
      return callOpenAIResponses(client, params);
    }

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
