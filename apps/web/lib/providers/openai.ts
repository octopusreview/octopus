import "server-only";
import { observeAiRequest, completionEvidence, sdkRequestOptions } from "./request-evidence";
import OpenAI from "openai";
import { createHmac } from "node:crypto";
import { CACHE_BREAKPOINT } from "./system-cache";
import type { Provider, AiCreateParams, AiResponse } from "./index";
import { stripLoneSurrogates } from "./sanitize";

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

/** Opaque, tenant/model/credential-scoped affinity; no history or model switching state. */
function promptCacheKey(params: AiCreateParams, apiKey: string | undefined, orgId?: string | null): string | undefined {
  if (!orgId || !apiKey || !params.cacheSystem || !params.system) return undefined;
  const prefix = stripLoneSurrogates(params.system.split(CACHE_BREAKPOINT)[0]);
  if (!prefix.trim()) return undefined;
  return createHmac("sha256", apiKey)
    .update(JSON.stringify(["octopus-cache-v1", orgId, params.model, prefix, params.responseSchema ?? null]))
    .digest("hex");
}

// Newer OpenAI models report writes even though the installed SDK predates the field.
function cacheWrites(details: { cached_tokens?: number } | null | undefined): number {
  const value = (details as { cache_write_tokens?: unknown } | null | undefined)?.cache_write_tokens;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

async function callOpenAIResponses(
  client: OpenAI,
  params: AiCreateParams,
  cacheKey?: string,
): Promise<AiResponse> {
  const response = await client.responses.create(observeAiRequest(params, "openai", {
    model: params.model,
    ...(cacheKey ? { prompt_cache_key: cacheKey } : {}),
    instructions: params.system === undefined ? undefined : stripLoneSurrogates(params.system),
    input: params.messages.map((m) => ({ role: m.role, content: stripLoneSurrogates(m.content) })),
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
  }), sdkRequestOptions(params));

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
    completion: completionEvidence(response.status, ["completed"]),
    provider: "openai",
    model: params.model,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cacheReadTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: cacheWrites(response.usage?.input_tokens_details),
    },
  };
}

export const openaiProvider: Provider = {
  name: "openai",
  supportsJsonSchema: true,
  async create(params: AiCreateParams, apiKey?: string | null, orgId?: string | null): Promise<AiResponse> {
    const client = getClient(apiKey);
    const cacheKey = promptCacheKey(params, apiKey || process.env.OPENAI_API_KEY, orgId);

    if (usesResponsesApi(params.model)) {
      return callOpenAIResponses(client, params, cacheKey);
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (params.system) {
      messages.push({ role: "system", content: stripLoneSurrogates(params.system) });
    }
    for (const m of params.messages) {
      messages.push({ role: m.role, content: stripLoneSurrogates(m.content) });
    }

    const response = await client.chat.completions.create(observeAiRequest(params, "openai", {
      model: params.model,
      max_completion_tokens: params.maxTokens,
      ...(cacheKey ? { prompt_cache_key: cacheKey } : {}),
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
    }), sdkRequestOptions(params));

    const text = response.choices[0]?.message?.content ?? "";

    return {
      text,
      completion: completionEvidence(response.choices[0]?.finish_reason, ["stop"]),
      provider: "openai",
      model: params.model,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        cacheReadTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: cacheWrites(response.usage?.prompt_tokens_details),
      },
    };
  },
};
