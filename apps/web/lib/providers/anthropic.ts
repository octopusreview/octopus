import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Provider, AiCreateParams, AiResponse } from "./index";
import { splitSystemForCache, type CacheTtl } from "./system-cache";
import { resolveThinking, resolveThinkingOverride } from "./thinking";
import { stripLoneSurrogates } from "./sanitize";

let platformClient: Anthropic | null = null;

function getClient(apiKey?: string | null): Anthropic {
  if (apiKey) return new Anthropic({ apiKey });
  if (!platformClient) {
    platformClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return platformClient;
}

/**
 * Hard deadline for one Anthropic call, thinking time included. The SDK's
 * built-in timeout only covers time-to-response-headers (its clearTimeout
 * runs as soon as fetch resolves), so once the SSE stream is open a stalled
 * connection would hang finalMessage() forever. A caller-supplied abort
 * signal, by contrast, stays attached for the whole body read. Keep this
 * below the review queue's 900s job timeout so the call fails with a clear,
 * retryable error instead of the job silently expiring.
 */
const ANTHROPIC_CALL_TIMEOUT_MS = 14 * 60 * 1000;

export const anthropicProvider: Provider = {
  name: "anthropic",
  supportsJsonSchema: true,
  async create(params: AiCreateParams, apiKey?: string | null): Promise<AiResponse> {
    const client = getClient(apiKey);

    // Prompt-cache TTL for the stable system prefix. Default 1h so the cached
    // rulepack/instruction prefix survives across a repo's review burst (5m
    // expires between sporadic reviews → low hit rate). Set PROMPT_CACHE_TTL=5m
    // to opt back down. Read at call time so it's tunable without a redeploy.
    const cacheTtl: CacheTtl = process.env.PROMPT_CACHE_TTL === "5m" ? "5m" : "1h";

    // When a responseSchema is provided, use Anthropic tool-use for enforced
    // structured output: define a single tool whose input_schema matches the
    // requested shape, force it via tool_choice, then return the tool input.
    const useTool = params.responseSchema !== undefined;

    // Always-thinking models (Fable/Mythos): raise max_tokens to the floor and,
    // on the text path, use adaptive thinking + effort so the answer isn't
    // starved. (These models reject an explicit thinking budget.)
    const { maxTokens, thinking, outputConfig } = resolveThinking(
      params.model,
      params.maxTokens,
      useTool,
      params.effort,
    );
    const thinkingParam = resolveThinkingOverride(params.model, params.thinking, thinking);

    // Streaming here is purely between this process and the Anthropic API —
    // finalMessage() buffers the SSE chunks and returns the same complete
    // Message object messages.create() would. It's required because thinking
    // models can take minutes before the first byte, and the SDK enforces
    // streaming for large max_tokens to avoid HTTP timeouts.
    const stream = client.messages.stream(
      {
        model: params.model,
        max_tokens: maxTokens,
        ...(thinkingParam ? { thinking: thinkingParam } : {}),
        ...(outputConfig ? { output_config: outputConfig } : {}),
        // Strip lone UTF-16 surrogates from all text: a diff/file body truncated
        // mid-emoji can leave an unpaired surrogate, which serializes to invalid
        // UTF-8 and makes Anthropic 400 the whole request ("no low surrogate").
        system: params.system
          ? splitSystemForCache(stripLoneSurrogates(params.system), params.cacheSystem, cacheTtl)
          : undefined,
        messages: params.messages.map((m) => ({
          role: m.role,
          content: stripLoneSurrogates(m.content),
        })),
        ...(useTool
          ? {
              tools: [
                {
                  name: params.responseSchema!.name,
                  description: `Return the response as a ${params.responseSchema!.name} object.`,
                  input_schema: params.responseSchema!.schema as Anthropic.Tool.InputSchema,
                },
              ],
              tool_choice: {
                type: "tool" as const,
                name: params.responseSchema!.name,
              },
            }
          : {}),
      },
      { signal: AbortSignal.timeout(ANTHROPIC_CALL_TIMEOUT_MS) },
    );

    let response: Anthropic.Message;
    try {
      response = await stream.finalMessage();
    } catch (err) {
      // Map the abort (only our timeout signal can trigger it here) to an
      // actionable error instead of the SDK's generic "Request was aborted".
      if (
        err instanceof Anthropic.APIUserAbortError ||
        (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError"))
      ) {
        throw new Error(
          `Anthropic call timed out after ${ANTHROPIC_CALL_TIMEOUT_MS / 1000}s (model: ${params.model})`,
        );
      }
      throw err;
    }

    let text: string;
    if (useTool) {
      const toolUse = response.content.find((block) => block.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") {
        throw new Error(
          `Anthropic returned no tool_use (stop_reason: ${response.stop_reason}, blocks: ${response.content.map((b) => b.type).join(",") || "none"})`,
        );
      }
      text = JSON.stringify(toolUse.input);
      if (!text || text === "{}") {
        throw new Error(
          `Anthropic returned empty structured output (stop_reason: ${response.stop_reason})`,
        );
      }
    } else {
      // Models with extended thinking (e.g. claude-fable-5) prepend a thinking
      // block, so the text block is not necessarily content[0] — collect every
      // text block instead of only the first.
      text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      // Surface empty responses as errors instead of silently returning an empty
      // review that downstream code would PATCH to GitHub as a blank comment (422).
      if (!text) {
        throw new Error(
          `Anthropic returned no text (stop_reason: ${response.stop_reason}, blocks: ${response.content.map((b) => b.type).join(",") || "none"})`,
        );
      }
    }

    return {
      text,
      provider: "anthropic",
      model: params.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
    };
  },
};
