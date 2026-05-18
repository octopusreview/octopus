import "server-only";
import OpenAI from "openai";
import { prisma } from "@octopus/db";
import type { Provider, AiCreateParams, AiResponse } from "./index";

/**
 * OpenRouter. Gateway to 100+ models from many vendors via a single API key.
 * OpenAI-compatible at `https://openrouter.ai/api/v1`. Model IDs are
 * namespaced (`openai/gpt-4o`, `anthropic/claude-sonnet-4-6`,
 * `nousresearch/hermes-3-llama-3.1-405b`, …).
 *
 * The HTTP-Referer + X-Title headers are recommended by OpenRouter for
 * attribution / rate-limit fairness; they're not enforced but they're free.
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

export async function getOrgOpenrouterKey(orgId?: string | null): Promise<string | null> {
  if (!orgId) return null;
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { openrouterApiKey: true },
  });
  return org?.openrouterApiKey ?? null;
}
