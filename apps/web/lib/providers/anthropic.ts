import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Provider, AiCreateParams, AiResponse } from "./index";

let platformClient: Anthropic | null = null;

function getClient(apiKey?: string | null): Anthropic {
  if (apiKey) return new Anthropic({ apiKey });
  if (!platformClient) {
    platformClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return platformClient;
}

/**
 * Claude Fable/Mythos models have always-on extended thinking that spends
 * from the max_tokens budget BEFORE any text is produced, and a tokenizer
 * that uses ~30% more tokens than Opus-tier models. Budgets tuned for other
 * models (8192 for reviews, 256 for titles) get fully consumed by the
 * thinking block on hard inputs, the response ends with
 * stop_reason "max_tokens" and zero text blocks, and the whole review fails.
 * Raise the cap to a floor that leaves room for thinking + text; max_tokens
 * is a ceiling, not a spend, so the floor costs nothing on easy inputs.
 */
const ALWAYS_THINKING_MODEL_RX = /^claude-(fable|mythos)-/;
const ALWAYS_THINKING_MAX_TOKENS_FLOOR = 64000;

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

    const maxTokens = ALWAYS_THINKING_MODEL_RX.test(params.model)
      ? Math.max(params.maxTokens, ALWAYS_THINKING_MAX_TOKENS_FLOOR)
      : params.maxTokens;

    // When a responseSchema is provided, use Anthropic tool-use for enforced
    // structured output: define a single tool whose input_schema matches the
    // requested shape, force it via tool_choice, then return the tool input.
    const useTool = params.responseSchema !== undefined;

    // Streaming here is purely between this process and the Anthropic API —
    // finalMessage() buffers the SSE chunks and returns the same complete
    // Message object messages.create() would. It's required because thinking
    // models can take minutes before the first byte, and the SDK enforces
    // streaming for large max_tokens to avoid HTTP timeouts.
    const stream = client.messages.stream(
      {
        model: params.model,
        max_tokens: maxTokens,
        system: params.system
          ? [
              {
                type: "text" as const,
                text: params.system,
                ...(params.cacheSystem
                  ? { cache_control: { type: "ephemeral" as const } }
                  : {}),
              },
            ]
          : undefined,
        messages: params.messages.map((m) => ({
          role: m.role,
          content: m.content,
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
