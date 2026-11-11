import type Anthropic from "@anthropic-ai/sdk";
import type { ModelInfo } from "@anthropic-ai/sdk/resources/models";
import { getModelPricing, estimateCompleteReviewCost } from "../cost";
import { sha256 } from "../review-coverage";
import { COMPLETE_REVIEW_POLICY as policy, capacityReceipt, refuseCapacity, generationTimeout,
  withinReviewWindow, type CapacityAdmissionReceipt, type CapacityRefusalReason } from "../review-capacity";
import type { AiCreateParams } from "./index";
import { CACHE_BREAKPOINT } from "./system-cache";
import { stripLoneSurrogates } from "./sanitize";
import { anthropicCountProjection, type AnthropicRequest } from "./anthropic-request";
import { AiProviderFailure, type KeyOwner } from "../provider-failure";

type CapacityClient = Pick<Anthropic, "baseURL" | "models" | "messages">;
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

/** Digest-only, per-attempt evidence. Metadata and count use the generation client's exact account route. */
export async function admitAnthropicReview(
  params: AiCreateParams, body: AnthropicRequest, client: CapacityClient, keyOwner: KeyOwner = "unknown",
): Promise<{ receipt: CapacityAdmissionReceipt; dispatchTimeout: () => number }> {
  const admission = params.completeReviewAdmission!;
  const receipt = capacityReceipt(admission, params.model);
  const reject = (reason: CapacityRefusalReason, error?: unknown): never => refuseCapacity(admission, receipt, reason, error);
  const checkTime = (): number => { try { return generationTimeout(admission.window, true); } catch { return reject("execution-window"); } };
  const preflight = async <T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> =>
    withinReviewWindow(admission.window, Math.min(ms, admission.window.remainingMs() - policy.minGenerationMs - policy.publicationReserveMs), work);
  checkTime();
  if (params.model !== policy.model || typeof client.baseURL !== "string" || client.baseURL.replace(/\/$/, "") !== "https://api.anthropic.com") reject("unsupported-route");
  const knownParams = new Set(["model", "maxTokens", "system", "messages", "cacheSystem", "effort", "thinking", "onRequest", "completeReviewAdmission", "executionWindow", "maxRetries"]);
  if (params.responseSchema !== undefined || Object.keys(params).some(key => !knownParams.has(key))) reject("unsupported-payload");
  const countBody = anthropicCountProjection(body);
  if (!countBody || body.thinking?.type !== "adaptive" || !body.output_config?.effort) return reject("unsupported-payload");

  const requestedSystem = params.system ?? "";
  const preparedSystem = typeof body.system === "string" ? body.system : (body.system ?? []).map(block => block.text).join("");
  receipt.requestedSystemSha256 = sha256(requestedSystem);
  receipt.preparedSystemSha256 = sha256(preparedSystem);
  receipt.generationPayloadSha256 = sha256(JSON.stringify(body));
  receipt.generationRequestBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
  receipt.countRequestBytes = Buffer.byteLength(JSON.stringify(countBody), "utf8");
  receipt.effectiveMaxTokens = body.max_tokens;
  receipt.effort = body.output_config.effort;
  if (stripLoneSurrogates(requestedSystem) !== requestedSystem
    || requestedSystem.split(CACHE_BREAKPOINT).join("") !== preparedSystem
    || params.messages.length !== body.messages.length
    || params.messages.some((message, i) => message.content !== body.messages[i].content || message.role !== body.messages[i].role)) reject("input-not-preserved");
  if (receipt.generationRequestBytes > policy.maxRequestBytes || receipt.countRequestBytes > policy.maxRequestBytes) reject("request-too-large");

  let metadata: ModelInfo;
  try {
    metadata = await preflight(policy.metadataTimeoutMs, signal => client.models.retrieve(params.model, {}, { signal, timeout: policy.metadataTimeoutMs, maxRetries: 0 }));
  } catch (error) {
    return reject(admission.window.signal.aborted ? "execution-window" : "metadata-unavailable",
      new AiProviderFailure(error, "anthropic", params.model, keyOwner));
  }
  const metadataMonotonic = performance.now();
  if (!metadata || typeof metadata.id !== "string") return reject("unsupported-capability");
  receipt.canonicalModel = metadata.id;
  receipt.capability = { sha256: sha256(JSON.stringify(metadata)), fetchedAt: Date.now(),
    maxInputTokens: positiveInteger(metadata.max_input_tokens) ? metadata.max_input_tokens : null,
    maxOutputTokens: positiveInteger(metadata.max_tokens) ? metadata.max_tokens : null };
  const effort = body.output_config.effort;
  if (metadata.id !== params.model || !positiveInteger(metadata.max_input_tokens) || !positiveInteger(metadata.max_tokens)
    || metadata.capabilities?.thinking?.supported !== true || metadata.capabilities.thinking.types?.adaptive?.supported !== true
    || metadata.capabilities.effort?.supported !== true || metadata.capabilities.effort[effort]?.supported !== true
    || !positiveInteger(body.max_tokens) || body.max_tokens > Math.min(metadata.max_tokens, policy.maxOutputTokens)) return reject("unsupported-capability");
  checkTime();

  let counted: { input_tokens: number };
  try {
    counted = await preflight(policy.countTimeoutMs, signal => client.messages.countTokens(countBody, { signal, timeout: policy.countTimeoutMs, maxRetries: 0 }));
  } catch (error) {
    return reject(admission.window.signal.aborted ? "execution-window" : "count-unavailable",
      new AiProviderFailure(error, "anthropic", params.model, keyOwner));
  }
  const countMonotonic = performance.now();
  if (!counted || !Number.isSafeInteger(counted.input_tokens) || counted.input_tokens < 0) return reject("invalid-count");
  receipt.count = { requestSha256: sha256(JSON.stringify(countBody)), inputTokens: counted.input_tokens, fetchedAt: Date.now() };
  checkTime();
  receipt.tokenMargin = Math.max(policy.tokenReserve, Math.ceil(counted.input_tokens * policy.tokenReserveFraction));
  const admittedInput = counted.input_tokens + receipt.tokenMargin;
  if (admittedInput + body.max_tokens > Math.min(policy.contextTokens, metadata.max_input_tokens)) reject("context-limit");

  // Apply the most expensive cache-write tier in the frozen body to all counted input.
  const systemBlocks = Array.isArray(body.system) ? body.system : [];
  const cacheMultiplier = systemBlocks.some(block => block.cache_control?.ttl === "1h") ? 2
    : systemBlocks.some(block => block.cache_control) ? 1.25 : 1;
  try {
    const pricing = await preflight(policy.metadataTimeoutMs, () => getModelPricing());
    const estimate = estimateCompleteReviewCost(pricing, params.model, admittedInput, body.max_tokens, cacheMultiplier);
    if (!estimate) return reject("pricing-unavailable");
    receipt.pricing = estimate.pricing;
    receipt.estimatedPrimaryUsd = estimate.estimateUsd;
  } catch (error) { return reject("pricing-unavailable", error); }
  if (receipt.estimatedPrimaryUsd! > policy.maxEstimateUsd) reject("cost-limit");

  let finalReason: Awaited<ReturnType<typeof admission.beforeGeneration>>;
  try {
    finalReason = await preflight(policy.countTimeoutMs, signal => admission.beforeGeneration(signal));
  } catch (error) { return reject(admission.window.signal.aborted ? "execution-window" : "final-check-failed", error); }
  if (finalReason) reject(finalReason);
  const dispatchTimeout = (): number => {
    const timeout = checkTime();
    if (performance.now() - metadataMonotonic > policy.maxEvidenceAgeMs || performance.now() - countMonotonic > policy.maxEvidenceAgeMs) reject("stale-evidence");
    if (body.model !== params.model || sha256(JSON.stringify(body)) !== receipt.generationPayloadSha256) reject("payload-changed");
    return timeout;
  };
  receipt.generationTimeoutMs = dispatchTimeout();
  receipt.state = "admitted";
  admission.onDecision?.(structuredClone(receipt));
  return { receipt, dispatchTimeout };
}
