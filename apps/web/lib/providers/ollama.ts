import "server-only";
import OpenAI from "openai";
import { prisma } from "@octopus/db";
import type { Provider, AiCreateParams, AiResponse } from "./index";
import { validateProviderUrl } from "./url-validation";

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
    if (org?.ollamaBaseUrl) {
      // Per-org URL is operator-supplied — validate before making it the
      // target of a server-side fetch (SSRF mitigation). See
      // apps/web/lib/providers/url-validation.ts.
      return validateProviderUrl(org.ollamaBaseUrl);
    }
  }
  const env = process.env.OLLAMA_BASE_URL;
  if (env) {
    // Env override is set by the deployment operator (not arbitrary user
    // input) — still parse to normalise, but allow private hosts since
    // env-based config is the standard "Ollama on the same machine" path.
    return validateProviderUrl(env, { hosted: false });
  }
  return DEFAULT_BASE_URL;
}

export const ollamaProvider: Provider = {
  name: "ollama" as never, // widen via the AiProvider union extension below
  supportsJsonSchema: false, // Ollama models can be asked for JSON but don't enforce schema yet
  async create(
    params: AiCreateParams,
    _apiKey?: string | null,
    orgId?: string,
  ): Promise<AiResponse> {
    // Honor per-org base URL when ai-router threads orgId through; falls
    // back to env / default otherwise (e.g. self-hosted using OLLAMA_BASE_URL).
    const baseURL = `${await resolveBaseUrl(orgId ?? null)}/v1`;
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
