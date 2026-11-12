import "server-only";
import { observeAiRequest, completionEvidence, sdkRequestOptions } from "./request-evidence";
import Anthropic from "@anthropic-ai/sdk";
import type { Provider, AiCreateParams, AiResponse } from "./index";
import { prepareAnthropicRequest, freezeRequest, usesNativeJsonOutput, type AnthropicRequest } from "./anthropic-request";
import { admitAnthropicReview } from "./anthropic-capacity";
import { providerKeyOwner } from "../provider-failure";
import { generationTimeout, CapacityAdmissionError, capacityReceipt, refuseCapacity, type CapacityAdmissionReceipt } from "../review-capacity";

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
    const useTool = params.responseSchema !== undefined && !usesNativeJsonOutput(params.model);
    let client: Anthropic;
    let body: AnthropicRequest;
    let admission: CapacityAdmissionReceipt | undefined;
    let admittedTimeout: (() => number) | undefined;
    try {
      client = getClient(apiKey);
      const prepared = prepareAnthropicRequest(params, process.env.PROMPT_CACHE_TTL === "5m" ? "5m" : "1h");
      body = params.completeReviewAdmission ? freezeRequest(prepared) : prepared;
      if (params.completeReviewAdmission) {
        const admitted = await admitAnthropicReview(params, body, client, providerKeyOwner("anthropic", !!apiKey));
        admission = admitted.receipt;
        admittedTimeout = admitted.dispatchTimeout;
      }
    } catch (error) {
      if (error instanceof CapacityAdmissionError || !params.completeReviewAdmission) throw error;
      refuseCapacity(params.completeReviewAdmission, capacityReceipt(params.completeReviewAdmission, params.model), "unsupported-payload");
    }
    const window = params.completeReviewAdmission?.window ?? params.executionWindow;
    let timeoutMs: number;
    try {
      timeoutMs = admittedTimeout ? admittedTimeout() : window ? generationTimeout(window, false) : ANTHROPIC_CALL_TIMEOUT_MS;
    } catch (error) {
      if (error instanceof CapacityAdmissionError) throw error;
      if (admission) refuseCapacity(params.completeReviewAdmission!, admission, "execution-window");
      throw error;
    }
    const signal = window
      ? AbortSignal.any([window.signal, AbortSignal.timeout(timeoutMs), ...(params.signal ? [params.signal] : [])])
      : params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    // This is a local call-start observation, not a provider delivery receipt.
    if (admission) {
      admission.generationTimeoutMs = timeoutMs;
      admission.primaryDispatch = "started";
      params.completeReviewAdmission!.onDecision?.(structuredClone(admission));
    }
    // SDK 0.91.1 serializes between_tools correctly but does not yet type it.
    const stream = client.messages.stream(observeAiRequest(params, "anthropic", body) as Anthropic.MessageCreateParamsStreaming, {
      ...sdkRequestOptions(params),
      signal,
      ...(window ? { maxRetries: 0, timeout: timeoutMs } : {}),
    });

    let response: Anthropic.Message;
    try {
      response = await stream.finalMessage();
    } catch (err) {
      // Surface both queue cancellation and the bounded stream deadline.
      if (
        err instanceof Anthropic.APIUserAbortError ||
        (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError"))
      ) {
        throw new Error(
          `Anthropic call interrupted or timed out within ${timeoutMs / 1000}s (model: ${params.model})`,
        );
      }
      throw err;
    }

    let text: string;
    if (useTool) {
      const toolUse = response.content.find((block) => block.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") {
        throw Object.assign(new Error(
          `Anthropic returned no tool_use (stop_reason: ${response.stop_reason}, blocks: ${response.content.map((b) => b.type).join(",") || "none"})`,
        ), response.stop_reason === "refusal" ? { code: "PROVIDER_REFUSAL" } : {});
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
        throw Object.assign(new Error(
          `Anthropic returned no text (stop_reason: ${response.stop_reason}, blocks: ${response.content.map((b) => b.type).join(",") || "none"})`,
        ), response.stop_reason === "refusal" ? { code: "PROVIDER_REFUSAL" } : {});
      }
    }

    return {
      text,
      completion: completionEvidence(response.stop_reason, useTool ? ["tool_use"] : ["end_turn"]),
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
