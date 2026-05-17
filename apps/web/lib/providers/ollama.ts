import "server-only";
import OpenAI from "openai";
import { prisma } from "@octopus/db";
import type { Provider, AiCreateParams, AiResponse } from "./index";

/**
 * Ollama exposes an OpenAI-compatible Chat Completions endpoint at
 * `<base>/v1/chat/completions`, so we reuse the OpenAI SDK with a custom
 * baseURL. The API key is ignored by Ollama but the SDK requires a non-empty
 * value — we pass a placeholder.
 *
 * Base URL resolution order:
 *   1. The current org's `ollamaBaseUrl` column (set via per-org config)
 *   2. The `OLLAMA_BASE_URL` env var
 *   3. http://localhost:11434  ← Ollama's default
 *
 * Pricing is zero — Ollama runs locally; `ai-usage.ts` treats `ollama` as
 * a free provider.
 */

const DEFAULT_BASE_URL = "http://localhost:11434";

async function resolveBaseUrl(orgId?: string | null): Promise<string> {
  if (orgId) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { ollamaBaseUrl: true },
    });
    if (org?.ollamaBaseUrl) return stripTrailingSlash(org.ollamaBaseUrl);
  }
  const env = process.env.OLLAMA_BASE_URL;
  if (env) return stripTrailingSlash(env);
  return DEFAULT_BASE_URL;
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

/**
 * The Ollama provider takes an optional second arg for the org id — needed
 * to look up the per-org base URL override. Other providers ignore the
 * second arg; the Provider interface allows callers to pass it conditionally.
 *
 * For callers using the standard Provider#create signature (no orgId arg),
 * the base URL falls back to env / default.
 */
export const ollamaProvider: Provider = {
  name: "ollama" as never, // widen via the AiProvider union extension below
  supportsJsonSchema: false, // Ollama models can be asked for JSON but don't enforce schema yet
  async create(params: AiCreateParams, _apiKey?: string | null): Promise<AiResponse> {
    const baseURL = `${await resolveBaseUrl(null)}/v1`;
    const client = new OpenAI({ apiKey: "ollama", baseURL });

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (params.system) {
      messages.push({ role: "system", content: params.system });
    }
    for (const m of params.messages) {
      messages.push({ role: m.role, content: m.content });
    }

    // Ollama strips the "ollama:" prefix Octopus uses to namespace local models.
    // Pass through the model id unchanged if no prefix; strip it otherwise.
    const model = params.model.startsWith("ollama:") ? params.model.slice(7) : params.model;

    const response = await client.chat.completions.create({
      model,
      max_completion_tokens: params.maxTokens,
      messages,
    });

    const text = response.choices[0]?.message?.content ?? "";

    return {
      text,
      provider: "ollama" as never,
      model: params.model,
      usage: {
        // Ollama reports tokens through OpenAI's `usage` field when running
        // in compatibility mode. Falls back to zero when absent.
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  },
};
