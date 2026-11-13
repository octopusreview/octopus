import { sha256, prepareReviewInput, type ReviewCoverage, type ReviewInput } from "./review-coverage";
import { DIFF_CHAR_CAP, MAX_FETCH_DIFF_CHARS } from "./diff-truncate";
import { AiProviderFailure, safeErrorDetails, type KeyOwner } from "./provider-failure";
import { setTimeout as delay } from "node:timers/promises";

/** Product admission limits, not a claim about a particular review's fit or invoice. */
export const COMPLETE_REVIEW_POLICY = Object.freeze({
  id: "anthropic-complete-review-v1" as const, models: Object.freeze(["claude-fable-5-1", "claude-fable-5-2"]),
  maxChars: 1_500_000, maxRequestBytes: 4 * 1024 * 1024,
  contextTokens: 1_000_000, maxOutputTokens: 128_000, tokenReserve: 4096,
  tokenReserveFraction: 0.1, maxEstimateUsd: 15, maxEvidenceAgeMs: 60_000,
  metadataTimeoutMs: 5_000, countTimeoutMs: 15_000,
  minGenerationMs: 600_000, maxGenerationMs: 840_000, publicationReserveMs: 60_000,
});

/** Exact ids only: an alias or a sibling model is never admitted. Limits are still checked per request against live model metadata. */
export const isCompleteReviewModel = (model: string): boolean => COMPLETE_REVIEW_POLICY.models.includes(model);

export type ReviewExecutionWindow = {
  jobId: string;
  deadlineEpochMs: number;
  signal: AbortSignal;
  remainingMs: () => number;
};

/** Convert pg-boss's actual lifetime to a monotonic deadline; wall-clock drift cannot extend it. */
export function createReviewExecutionWindow(
  job: { id: string; startedOn: Date; expireInSeconds: number; signal: AbortSignal },
  clock = { epoch: Date.now, monotonic: () => performance.now() },
): ReviewExecutionWindow | undefined {
  const entered = clock.epoch();
  const duration = job.expireInSeconds * 1000;
  const started = job.startedOn?.getTime();
  if (!Number.isFinite(started) || !Number.isFinite(duration) || duration <= 0 || !job.signal) return undefined;
  const deadlineEpochMs = Math.min(started + duration, entered + duration);
  const remaining = Math.max(0, deadlineEpochMs - entered);
  const deadline = clock.monotonic() + remaining;
  return { jobId: job.id, deadlineEpochMs, signal: job.signal, remainingMs: () => Math.max(0, deadline - clock.monotonic()) };
}

export function isReviewCancelled(window?: ReviewExecutionWindow): boolean {
  return !!window?.signal.aborted && window.signal.reason?.name !== "TimeoutError" && window.remainingMs() > 0;
}

/** Also bounds non-cancellable read-only DB lookups; they may finish after this waiter rejects. */
export async function withinReviewWindow<T>(window: ReviewExecutionWindow, maxMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ms = Math.floor(Math.min(window.remainingMs(), maxMs));
  if (window.signal.aborted || ms <= 0) throw new Error("Review execution deadline reached or cancelled");
  const signal = AbortSignal.any([window.signal, AbortSignal.timeout(ms)]);
  let abort: () => void = () => {};
  try {
    const result = await Promise.race([
      new Promise<never>((_, reject) => {
        abort = () => reject(new Error("Review execution deadline reached or cancelled"));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
      work(signal),
    ]);
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** One automatic retry of a transient generation failure; it must fit inside the original job. */
export const GENERATION_RETRY = Object.freeze({ minGenerationMs: 180_000, backoffMs: 1_000 });

/** Wait, then confirm the review is still current, only if the retry still fits the original window afterwards. */
export async function admitGenerationRetry(
  window: ReviewExecutionWindow | undefined, minGenerationMs: number, retryAfterMs: number | undefined,
  confirm: (signal: AbortSignal) => Promise<boolean>,
): Promise<boolean> {
  const waitMs = retryAfterMs ?? GENERATION_RETRY.backoffMs;
  const needed = minGenerationMs + COMPLETE_REVIEW_POLICY.publicationReserveMs;
  if (!window || window.signal.aborted || window.remainingMs() - waitMs < needed) return false;
  try {
    await delay(waitMs, undefined, { signal: window.signal });
    return await withinReviewWindow(window, window.remainingMs() - needed, confirm) && window.remainingMs() >= needed;
  } catch { return false; }
}

export function generationTimeout(window: ReviewExecutionWindow, primary: boolean): number {
  const available = Math.floor(Math.min(COMPLETE_REVIEW_POLICY.maxGenerationMs,
    window.remainingMs() - COMPLETE_REVIEW_POLICY.publicationReserveMs));
  if (window.signal.aborted || available < (primary ? COMPLETE_REVIEW_POLICY.minGenerationMs : 1)) {
    throw new Error("Insufficient review execution time or cancelled");
  }
  return available;
}

/** Post-primary cancellation is a processing failure, never a no-dispatch admission refusal. */
export class ReviewProcessingExpiredError extends Error {
  constructor() { super("Review processing cancelled or expired before completion"); this.name = "ReviewProcessingExpiredError"; }
}

export function assertReviewProcessingActive(window: ReviewExecutionWindow): void {
  if (window.signal.aborted || window.remainingMs() <= 0) throw new ReviewProcessingExpiredError();
}

export type CapacityRefusalReason = "unsupported-route" | "unsupported-payload" | "input-not-preserved"
  | "request-too-large" | "metadata-unavailable" | "unsupported-capability" | "count-unavailable"
  | "invalid-count" | "context-limit" | "pricing-unavailable" | "cost-limit" | "execution-window"
  | "stale-evidence" | "stale-review" | "billing-blocked" | "credential-route-changed" | "final-check-failed" | "payload-changed";

export type CapacityAdmissionReceipt = {
  version: 1;
  policy: typeof COMPLETE_REVIEW_POLICY.id;
  state: "admitted" | "rejected";
  reason: CapacityRefusalReason | null;
  capSource: "default";
  candidateSha256: string;
  preparedSource: { chars: number; files: number; hunks: number };
  headSha: string;
  baseSha: string;
  reviewRequestVersion: number;
  logicalModel: string;
  canonicalModel: string | null;
  provider: "anthropic";
  capability: { sha256: string; fetchedAt: number; maxInputTokens: number | null; maxOutputTokens: number | null } | null;
  count: { requestSha256: string; inputTokens: number; fetchedAt: number } | null;
  generationPayloadSha256: string | null;
  generationRequestBytes: number | null;
  countRequestBytes: number | null;
  requestedSystemSha256: string | null;
  preparedSystemSha256: string | null;
  tokenMargin: number | null;
  effectiveMaxTokens: number | null;
  effort: string | null;
  pricing: { identity: string; input: number; output: number; cacheWriteMultiplier: number; markup: number } | null;
  estimatedPrimaryUsd: number | null;
  allowanceUsd: number;
  jobId: string;
  deadlineEpochMs: number;
  generationTimeoutMs: number | null;
  /** Local stream-call boundary only; never proof of provider delivery or exactly-once spend. */
  primaryDispatch: "not-started" | "started";
};

export type CompleteReviewAdmission = {
  candidateSha256: string;
  preparedSource: CapacityAdmissionReceipt["preparedSource"];
  headSha: string;
  baseSha: string;
  reviewRequestVersion: number;
  window: ReviewExecutionWindow;
  beforeGeneration: (signal: AbortSignal) => Promise<"stale-review" | "billing-blocked" | "credential-route-changed" | null>;
  onDecision?: (receipt: CapacityAdmissionReceipt) => void;
};

export function capacityReceipt(admission: CompleteReviewAdmission, model: string): CapacityAdmissionReceipt {
  return { version: 1, policy: COMPLETE_REVIEW_POLICY.id, state: "rejected", reason: null, capSource: "default",
    candidateSha256: admission.candidateSha256, preparedSource: { ...admission.preparedSource }, headSha: admission.headSha, baseSha: admission.baseSha,
    reviewRequestVersion: admission.reviewRequestVersion, logicalModel: model, canonicalModel: null, provider: "anthropic",
    capability: null, count: null, generationPayloadSha256: null, generationRequestBytes: null, countRequestBytes: null,
    requestedSystemSha256: null, preparedSystemSha256: null, tokenMargin: null, effectiveMaxTokens: null,
    effort: null, pricing: null, estimatedPrimaryUsd: null, allowanceUsd: COMPLETE_REVIEW_POLICY.maxEstimateUsd,
    jobId: admission.window.jobId, deadlineEpochMs: admission.window.deadlineEpochMs,
    generationTimeoutMs: null, primaryDispatch: "not-started" };
}

export class CapacityAdmissionError extends Error {
  readonly details: ReturnType<typeof safeErrorDetails>;
  readonly keyOwner: KeyOwner;
  readonly provider: AiProviderFailure["provider"] | undefined;
  constructor(public readonly receipt: CapacityAdmissionReceipt, error?: unknown) {
    super(`Complete review admission refused: ${receipt.reason ?? "final-check-failed"}`);
    this.name = "CapacityAdmissionError";
    this.details = error instanceof AiProviderFailure ? error.details : safeErrorDetails(error);
    this.keyOwner = error instanceof AiProviderFailure ? error.keyOwner : "unknown";
    this.provider = error instanceof AiProviderFailure ? error.provider : undefined;
  }
}

export function refuseCapacity(admission: CompleteReviewAdmission, receipt: CapacityAdmissionReceipt, reason: CapacityRefusalReason, error?: unknown): never {
  if (error instanceof CapacityAdmissionError) throw error;
  receipt.state = "rejected";
  receipt.reason = reason;
  admission.onDecision?.(structuredClone(receipt));
  throw new CapacityAdmissionError(receipt, error);
}

/** No supplied hunk can be claimed after a proven refusal before generation. Keep acquired patch identities. */
export function markCapacityNotDispatched(coverage: ReviewCoverage): void {
  for (const file of coverage.files) {
    if (file.state === "supplied" || file.state === "partial" || file.state === "omitted") {
      file.state = "omitted";
      file.reason = "Complete review admission refused before generation; changed source not dispatched";
      file.suppliedChars = 0;
      file.suppliedSha256 = null;
      file.hunks = [];
    }
  }
  coverage.complete = false;
}

/** Reuse the ordinary parser and policy matchers; expansion never chooses another partial subset. */
export function completeReviewCandidate(
  input: ReviewInput, options: Parameters<typeof prepareReviewInput>[1],
  baseline: ReturnType<typeof prepareReviewInput>, model: string, provider: string,
  window?: ReviewExecutionWindow,
  cap = DIFF_CHAR_CAP, fetchChars = MAX_FETCH_DIFF_CHARS,
): ReturnType<typeof prepareReviewInput> | null {
  if (cap.source !== "default" || !isCompleteReviewModel(model) || provider !== "anthropic"
    || !window || window.signal.aborted || baseline.coverage.complete || !input.headSha || !input.baseSha
    || !baseline.coverage.files.some(file => file.state === "partial" || file.state === "omitted")) return null;
  try { generationTimeout(window, true); } catch { return null; }
  const maxChars = Math.min(COMPLETE_REVIEW_POLICY.maxChars, Math.floor(fetchChars));
  if (!Number.isFinite(maxChars) || maxChars <= cap.value) return null;
  const candidate = prepareReviewInput(input, { ...options, maxChars });
  return candidate.coverage.complete && candidate.diff.length <= maxChars ? candidate : null;
}

export function reviewCandidateSha256(prepared: ReturnType<typeof prepareReviewInput>): string {
  return sha256(JSON.stringify({ diff: prepared.diff, coverage: prepared.coverage }));
}

export function reviewPublicationSignal(window?: ReviewExecutionWindow, maxMs?: number): AbortSignal | undefined {
  if (!window) return maxMs === undefined ? undefined : AbortSignal.timeout(maxMs);
  assertReviewProcessingActive(window);
  const ms = Math.max(1, Math.floor(Math.min(window.remainingMs(), maxMs ?? Infinity)));
  return AbortSignal.any([window.signal, AbortSignal.timeout(ms)]);
}
