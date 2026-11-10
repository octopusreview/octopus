import { mock, spyOn } from "bun:test";
import assert from "node:assert/strict";
import type { AiCreateParams } from "../../providers";
import type { CapacityRefusalReason } from "../../review-capacity";

mock.module("server-only", () => ({}));
const sentryEvents: Array<{ tags?: Record<string, unknown>; contexts?: Record<string, Record<string, unknown>> }> = [];
mock.module("@sentry/nextjs", () => ({ captureEvent: (event: typeof sentryEvents[number]) => { sentryEvents.push(event); return "e".repeat(32); } }));
const { reportBackgroundFailure } = await import("../../background-failure");
let providerStatus: number | undefined;
let pricingFailure: Error | undefined;
let organizationFailure: Error | undefined;
let revisionFailure: Error | undefined;
// Every external boundary is synthetic. Any unexpected HTTP access fails immediately.
globalThis.fetch = (() => { throw new Error("Unexpected network access in capacity harness"); }) as typeof fetch;
let provider = "anthropic";
let org = { type: "TEAM", anthropicApiKey: "synthetic-byok", creditBalance: 0, freeCreditBalance: 0, monthlySpendLimitUsd: null };
let saved: { coverage: import("../../review-coverage").ReviewCoverage; reviewBody: string } | undefined;
let claim = { id: "synthetic-pr", headSha: "a".repeat(40), reviewRequestVersion: 3, status: "reviewing" };
let paused = false;
let remote = { headSha: "a".repeat(40), baseSha: "b".repeat(40) };
let usageRow: { usedOwnKey: boolean } | undefined;
const charges: number[] = [];
mock.module("../../credits", () => ({ deductCredits: async (_org: string, amount: number) => { charges.push(amount); } }));
const db = {
  aiUsage: { create: async ({ data }: { data: { usedOwnKey: boolean } }) => { usageRow = data; return { id: "usage" }; }, update: async () => ({}) },
  availableModel: { findMany: async (query: { select?: { inputPrice?: boolean } }) => {
    if (pricingFailure && query.select?.inputPrice) throw pricingFailure;
    return [{ modelId: "claude-fable-5-1", provider, inputPrice: 0, outputPrice: 0 }];
  } },
  organization: { findUnique: async () => { if (organizationFailure) throw organizationFailure; return org; } },
  reviewAttempt: { createMany: async ({ data }: { data: NonNullable<typeof saved>[] }) => { saved = structuredClone(data[0]); return { count: 1 }; } },
  pullRequest: { updateMany: async () => ({ count: 1 }),
    findFirst: async ({ where }: { where: typeof claim }) => Object.keys(where).every(key => where[key as keyof typeof where] === claim[key as keyof typeof claim])
      ? { id: claim.id, repository: { organization: { reviewsPaused: paused } } } : null },
};
mock.module("@octopus/db", () => ({ prisma: { ...db, $transaction: (fn: (tx: typeof db) => unknown) => fn(db) } }));
mock.module("../../crypto", () => ({
  decryptStringMaybeLegacy: (value: string) => value,
  encryptString: () => { throw new Error("Unexpected credential encryption in capacity harness"); },
  encryptJson: () => { throw new Error("Unexpected connector encryption in capacity harness"); },
  decryptJson: () => { throw new Error("Unexpected connector decryption in capacity harness"); },
}));
mock.module("../../ai-client", () => ({ getReviewModel: () => { throw new Error("Frozen route must not resolve an organization default"); } }));
let count = 300_000, endpoint = "https://api.anthropic.com", mode = "normal";
let metadata: ReturnType<typeof validMetadata>;
let before: (signal: AbortSignal) => Promise<"stale-review" | "billing-blocked" | null> = async () => null;
let remaining = 900_000;
let controller = new AbortController();
const calls: { operation: string; body: unknown; options: Record<string, unknown>; client: unknown }[] = [];
let generationBody: Record<string, unknown> | undefined;
function validMetadata() {
  return { id: "claude-fable-5-1", max_input_tokens: 1_000_000 as number | null, max_tokens: 128_000 as number | null,
    capabilities: { thinking: { supported: true, types: { adaptive: { supported: true } } },
      effort: { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: true }, xhigh: { supported: true }, max: { supported: true } } } };
}
const valid = `## 🐙 Octopus Review\n\n### Summary\nThe synthetic change is consistent.\n\n### Score\n| Category | Score | Notes |\n| --- | --- | --- |\n| Security | 5/5 | Checked |\n| Code Quality | 5/5 | Checked |\n| Performance | 5/5 | Checked |\n| Error Handling | 5/5 | Checked |\n| Consistency | 4/5 | Checked |\n| **Overall** | **4/5** | Checked |\n\n### Findings Summary\n| Severity | Count |\n| --- | --- |\n| 🔴 Critical | 0 |\n| 🟠 High | 0 |\n| 🟡 Medium | 0 |\n| 🔵 Low | 0 |\n| 💡 Nit | 0 |\n\n### Findings\n<!-- OCTOPUS_FINDINGS_START -->\n[]\n<!-- OCTOPUS_FINDINGS_END -->`;
class FakeAnthropic {
  static APIUserAbortError = class extends Error {};
  baseURL = endpoint;
  models = { retrieve: async (model: string, _: unknown, options: Record<string, unknown>) => {
    calls.push({ operation: "metadata", body: model, options, client: this });
    if (mode === "metadata-failure") throw Object.assign(new Error("private provider error must not appear in evidence"), { status: providerStatus });
    if (mode === "metadata-cancel") controller.abort();
    if (mode === "metadata-slow") remaining = 659_999;
    return structuredClone(metadata);
  } };
  messages = {
    countTokens: async (body: unknown, options: Record<string, unknown>) => {
      calls.push({ operation: "count", body: structuredClone(body), options, client: this });
      if (mode === "count-failure") throw Object.assign(new Error("private count error"), { status: providerStatus });
      if (mode === "count-cancel") controller.abort();
      if (mode === "count-slow") remaining = 659_999;
      return { input_tokens: count, _request_id: "req_synthetic_count" };
    },
    stream: (body: Record<string, unknown>, options: Record<string, unknown>) => {
      calls.push({ operation: "generation", body: structuredClone(body), options, client: this });
      generationBody = body;
      return { finalMessage: async () => {
        if (mode === "generation-cancel") { controller.abort(); throw new FakeAnthropic.APIUserAbortError(); }
        if (mode === "generation-add") org = { ...org, anthropicApiKey: "synthetic-new" };
        if (mode === "generation-remove") org = { ...org, anthropicApiKey: "" };
        if (mode === "generation-rotate") org = { ...org, anthropicApiKey: "synthetic-rotated" };
        if (mode === "generation-failure") throw new Error("synthetic transport ambiguity");
        return { content: [{ type: "text", text: mode === "malformed" ? "bad response" : valid }],
          stop_reason: mode === "truncated" ? "max_tokens" : "end_turn",
          usage: { input_tokens: 300000, output_tokens: 2000 } };
      } };
    },
  };
}
mock.module("@anthropic-ai/sdk", () => ({ default: FakeAnthropic }));
const { anthropicProvider } = await import("../../providers/anthropic");
// Isolate unrelated providers while exercising the real router and selected adapter.
mock.module("../../providers", () => ({ getProvider: () => anthropicProvider }));
const { logAiUsage } = await import("../../ai-usage");
const { createAiMessage } = await import("../../ai-router");
const { estimateCompleteReviewCost, getOrgSpendLimitStatus, getModelPricing } = await import("../../cost");
const { executeCoveredReview } = await import("../../review-assessment");
const { prepareReviewInput, applyReviewCoverage, reviewCheckResult, sha256 } = await import("../../review-coverage");
const { CapacityAdmissionError, isReviewCancelled, COMPLETE_REVIEW_POLICY: policy } = await import("../../review-capacity");
const { prepareAnthropicRequest, freezeRequest, anthropicCountProjection } = await import("../../providers/anthropic-request");
const { admitAnthropicReview } = await import("../../providers/anthropic-capacity");
const { saveReviewAttempt } = await import("../../review-attempt");
const { confirmCompleteReviewCurrent } = await import("../../review-capacity-current");
const { GithubRateLimitError } = await import("../../github");
const currentCheck = (signal: AbortSignal) => confirmCompleteReviewCurrent({ pullRequestId: "synthetic-pr", orgId: "synthetic", repoId: "repo",
  model: policy.model, headSha: "a".repeat(40), baseSha: "b".repeat(40), reviewRequestVersion: 3,
  fetchRevision: async () => { if (revisionFailure) throw revisionFailure; return { ...remote }; },
}, signal);

function reset() {
  calls.length = 0; mode = "normal"; count = 300000; endpoint = "https://api.anthropic.com";
  metadata = validMetadata(); remaining = 900000; controller = new AbortController(); before = currentCheck;
  claim = { id: "synthetic-pr", headSha: "a".repeat(40), reviewRequestVersion: 3, status: "reviewing" };
  paused = false; remote = { headSha: "a".repeat(40), baseSha: "b".repeat(40) };
  generationBody = undefined; revisionFailure = undefined;
}
function prepared() {
  const result = prepareReviewInput({ provider: "github", headSha: "a".repeat(40), baseSha: "b".repeat(40),
    expectedFiles: 1, inventoryComplete: true, limitations: [], files: [{ path: "src/code.ts", change: "added",
      additions: 1, deletions: 0, patch: `@@ -0,0 +1 @@\n+${"x".repeat(400000)}\n` }] }, { maxChars: 1500000 });
  result.coverage.reviewRequestVersion = 3;
  return result;
}
function request(p = prepared()): AiCreateParams {
  return { model: policy.model, maxTokens: 8192, effort: "max", cacheSystem: true,
    system: `Rules<!--CACHE_BREAKPOINT-->RAG context ${"x".repeat(40000)}\nRepository config`,
    messages: [{ role: "user", content: p.diff }], completeReviewAdmission: {
      candidateSha256: sha256(JSON.stringify(p)), headSha: p.coverage.headSha!, baseSha: p.coverage.baseSha!, reviewRequestVersion: 3,
      preparedSource: { chars: p.diff.length, files: 1, hunks: 1 },
      window: { jobId: "synthetic-job", deadlineEpochMs: Date.now() + 900000, signal: controller.signal, remainingMs: () => remaining },
      beforeGeneration: signal => before(signal),
    } };
}
async function refusal(reason: CapacityRefusalReason, edit?: (params: AiCreateParams) => void) {
  const p = prepared(), params = request(p); edit?.(params);
  let caught: unknown;
  try { await executeCoveredReview(params, p.coverage, "template", req => createAiMessage(req, "synthetic")); } catch (error) { caught = error; }
  assert.ok(caught instanceof CapacityAdmissionError, `${reason}/${mode}: ${String(caught)}`);
  assert.equal(caught.receipt.reason, reason);
  const incidentCount = sentryEvents.length;
  reportBackgroundFailure(caught, { stage: "generation", cancelled: isReviewCancelled(params.completeReviewAdmission?.window) });
  const actionable = ["metadata-unavailable", "count-unavailable", "invalid-count", "pricing-unavailable", "final-check-failed", "execution-window"].includes(reason);
  const expected = controller.signal.aborted;
  assert.equal(sentryEvents.length - incidentCount, actionable && !expected ? 1 : 0, reason);
  if (actionable && !expected) {
    assert.equal(sentryEvents.at(-1)?.tags?.failure_code, `capacity_${reason}`);
    assert.equal(sentryEvents.at(-1)?.tags?.failure_stage, "preparation");
    if (pricingFailure || organizationFailure || mode === "final-check-failure") {
      assert.equal(caught.keyOwner, "unknown");
      assert.equal(sentryEvents.at(-1)?.contexts?.background_failure?.keyOwner, "unknown");
      assert.equal(sentryEvents.at(-1)?.tags?.provider, "unknown");
      assert.equal(sentryEvents.at(-1)?.tags?.failure_owner, "unknown");
      assert.equal(caught.details.status, 429);
    }
    assert.ok(!JSON.stringify(sentryEvents.at(-1)).includes("private"));
  }
  assert.equal(caught.receipt.primaryDispatch, "not-started");
  assert.equal(calls.filter(call => call.operation === "generation").length, 0);
  assert.equal(p.coverage.complete, false);
  assert.equal(p.coverage.files[0].state, "omitted");
  assert.equal(p.coverage.files[0].suppliedChars, 0);
  assert.equal(p.coverage.files[0].suppliedSha256, null);
  assert.equal(p.coverage.files[0].hunks.length, 0);
  assert.ok(p.coverage.files[0].patchSha256);
  assert.equal(p.coverage.assessment?.requests.length, 0);
  assert.equal(p.coverage.assessment?.responseSha256, null);
  const body = applyReviewCoverage("Assessment unavailable", p.coverage, "synthetic-attempt");
  await saveReviewAttempt("synthetic-attempt", "synthetic-pr", p.coverage, body);
  assert.equal(saved?.coverage.assessment?.capacityAdmission?.reason, reason);
  assert.equal(saved?.coverage.assessment?.capacityAdmission?.preparedSource.hunks, 1);
  assert.equal(saved?.coverage.complete, false);
  assert.ok(!JSON.stringify(saved).includes("private provider error"));
  assert.equal(reviewCheckResult(p.coverage, false, 0).conclusion, "failure");
  if (process.env.REVIEW_TEST_EVIDENCE_DIR && reason === "cost-limit") {
    await Bun.write(`${process.env.REVIEW_TEST_EVIDENCE_DIR}/capacity-refusal.json`, JSON.stringify({ archived: saved, check: reviewCheckResult(p.coverage, false, 0) }, null, 2));
    await Bun.write(`${process.env.REVIEW_TEST_EVIDENCE_DIR}/capacity-refusal.html`, '<!doctype html><meta charset="utf-8"><title>Synthetic capacity refusal</title>' + Bun.markdown.html(body));
  }
}

for (const key of ["", "synthetic-byok"]) {
  reset(); org.anthropicApiKey = key;
  pricingFailure = Object.assign(new Error("private pricing response"), { status: 429 });
  try { await refusal("pricing-unavailable"); } finally { pricingFailure = undefined; }
}
org.anthropicApiKey = "synthetic-byok";

reset();
const p = prepared(), params = request(p);
const response = await executeCoveredReview(params, p.coverage, "template", req => createAiMessage(req, "synthetic"));
assert.equal(response.text, valid);
assert.equal(p.coverage.assessment?.state, "completed");
assert.deepEqual(calls.map(call => call.operation), ["metadata", "count", "generation"]);
assert.ok(calls.every(call => call.client === calls[0].client));
assert.equal(calls[0].options.timeout, 5000);
assert.equal(calls[1].options.timeout, 15000);
assert.ok(calls.every(call => call.options.maxRetries === 0));
const { max_tokens: maxTokens, stream, ...countFields } = generationBody!;
assert.equal(maxTokens, 64000); assert.equal(stream, true);
assert.deepEqual(calls[1].body, countFields);
assert.equal(p.coverage.assessment?.requests.length, 1);
const receipt = p.coverage.assessment!.capacityAdmission!;
assert.equal(receipt.generationPayloadSha256, p.coverage.assessment!.requests[0].sha256);
assert.equal(receipt.primaryDispatch, "started");
assert.equal(receipt.effort, "max"); assert.equal(receipt.tokenMargin, 30000);
assert.equal(receipt.pricing?.input, 10); assert.equal(receipt.pricing?.output, 50);
assert.equal(receipt.pricing?.cacheWriteMultiplier, 2);
assert.equal(receipt.estimatedPrimaryUsd, 11.76);
assert.equal(receipt.count?.requestId, "req_synthetic_count");
assert.ok(Object.isFrozen(generationBody)); assert.ok(Object.isFrozen(generationBody!.messages));
assert.equal(reviewCheckResult(p.coverage, false, 0).conclusion, "success");
if (process.env.REVIEW_TEST_EVIDENCE_DIR) {
  const body = applyReviewCoverage(response.text, p.coverage, "synthetic-admitted-attempt");
  await saveReviewAttempt("synthetic-admitted-attempt", "synthetic-pr", p.coverage, body);
  await Bun.write(`${process.env.REVIEW_TEST_EVIDENCE_DIR}/capacity-admitted.json`, JSON.stringify({ archived: saved, check: reviewCheckResult(p.coverage, false, 0) }, null, 2));
  await Bun.write(`${process.env.REVIEW_TEST_EVIDENCE_DIR}/capacity-admitted.html`, '<!doctype html><meta charset="utf-8"><title>Synthetic admitted review</title>' + Bun.markdown.html(body));
}

assert.equal(await getOrgSpendLimitStatus("synthetic", "repo", { model: policy.model, provider: "anthropic" }).then(s => s.blocked), false);
org = { ...org, anthropicApiKey: "" };
assert.equal(await getOrgSpendLimitStatus("synthetic", "repo", { model: policy.model, provider: "anthropic" }).then(s => s.blocked), true);
org = { ...org, anthropicApiKey: "synthetic-byok" };

for (const [scenario, reason] of [
  ["metadata-failure", "metadata-unavailable"], ["count-failure", "count-unavailable"],
  ["metadata-cancel", "execution-window"], ["count-cancel", "execution-window"],
  ["metadata-slow", "execution-window"], ["count-slow", "execution-window"],
] as const) { reset(); mode = scenario; await refusal(reason); }
for (const operation of ["metadata", "count"]) {
  for (const key of ["", "synthetic-byok"]) {
    for (const status of [401, 402, 403, 429, 503]) {
      reset(); mode = `${operation}-failure`; org.anthropicApiKey = key; providerStatus = status;
      await refusal(operation === "metadata" ? "metadata-unavailable" : "count-unavailable");
    }
  }
}
providerStatus = undefined; org.anthropicApiKey = "synthetic-byok";
for (const key of ["", "synthetic-byok"]) {
  reset(); org.anthropicApiKey = key;
  const dependencyError = Object.assign(new Error("private dependency response"), { status: 429 });
  organizationFailure = dependencyError;
  try { await refusal("final-check-failed"); } finally { organizationFailure = undefined; }
  reset(); mode = "final-check-failure";
  revisionFailure = new GithubRateLimitError(429, null);
  await refusal("final-check-failed");
  reset();
  before = async () => { organizationFailure = dependencyError; return null; };
  try { await refusal("final-check-failed"); } finally { organizationFailure = undefined; }
}
org.anthropicApiKey = "synthetic-byok";

reset(); endpoint = "https://gateway.invalid"; await refusal("unsupported-route"); assert.equal(calls.length, 0);
for (const edit of [
  () => { metadata.id = "canonical-alias"; },
  () => { metadata.max_input_tokens = null; },
  () => { metadata.max_tokens = 63999; },
  () => { metadata.capabilities.thinking.types.adaptive.supported = false; },
  () => { metadata.capabilities.effort.max.supported = false; },
]) { reset(); edit(); await refusal("unsupported-capability"); assert.equal(calls.length, 1); }
for (const value of [-1, 1.5, NaN, Infinity]) { reset(); count = value; await refusal("invalid-count"); }
reset(); count = 851000; await refusal("context-limit");
reset(); count = 422728; await refusal("cost-limit");
reset(); count = 422727;
const exact = prepared(); await executeCoveredReview(request(exact), exact.coverage, "template", req => createAiMessage(req, "synthetic"));
assert.equal(exact.coverage.assessment?.capacityAdmission?.estimatedPrimaryUsd, 15);
reset(); before = async () => "stale-review"; await refusal("stale-review");
reset(); before = async () => "billing-blocked"; await refusal("billing-blocked");
for (const edit of [
  () => { claim.status = "failed"; }, () => { claim.headSha = "c".repeat(40); }, () => { claim.reviewRequestVersion++; },
  () => { remote.headSha = "c".repeat(40); }, () => { remote.baseSha = "c".repeat(40); }, () => { paused = true; },
]) { reset(); edit(); await refusal("stale-review"); }
reset(); org = { ...org, anthropicApiKey: "" }; await refusal("billing-blocked"); org = { ...org, anthropicApiKey: "synthetic-byok" };
for (const [initialKey, nextKey] of [["", "synthetic-new-byok"], ["synthetic-byok", ""], ["synthetic-byok", "synthetic-rotated-byok"]]) {
  reset(); org = { ...org, anthropicApiKey: initialKey, creditBalance: 10 };
  before = async signal => {
    org = { ...org, anthropicApiKey: nextKey, creditBalance: initialKey === "" ? 0 : 10 };
    return currentCheck(signal);
  };
  await refusal("credential-route-changed");
  org = { ...org, anthropicApiKey: "synthetic-byok", creditBalance: 0 };
}
// A version or pause change while the remote read is pending must be seen by the later claim read.
for (const change of [() => { claim.reviewRequestVersion++; }, () => { paused = true; }]) {
  reset();
  const result = await confirmCompleteReviewCurrent({ pullRequestId: "synthetic-pr", orgId: "synthetic", repoId: "repo", model: policy.model,
    headSha: "a".repeat(40), baseSha: "b".repeat(40), reviewRequestVersion: 3,
    fetchRevision: async () => { await Promise.resolve(); change(); return remote; },
  }, controller.signal);
  assert.equal(result, "stale-review");
}
reset(); before = async () => { controller.abort(); return null; }; await refusal("execution-window");
reset(); before = async () => { remaining = 659999; return null; }; await refusal("execution-window");
reset(); await refusal("execution-window", req => { req.completeReviewAdmission!.onDecision = receipt => {
  if (receipt.state === "admitted" && receipt.primaryDispatch === "not-started") controller.abort();
}; });
reset();
let monotonic = 0;
const monotonicSpy = spyOn(performance, "now").mockImplementation(() => monotonic);
try {
  before = async () => { monotonic = 60001; return null; };
  await refusal("stale-evidence");
} finally { monotonicSpy.mockRestore(); }
reset(); await refusal("input-not-preserved", req => { req.messages[0].content += "\ud800"; }); assert.equal(calls.length, 0);
reset(); await refusal("input-not-preserved", req => { req.system += "\ud800"; });
reset(); await refusal("request-too-large", req => { req.system = "😀".repeat(1100000); }); assert.equal(calls.length, 0);
reset();
const byteBoundary = request(); byteBoundary.system = "";
// A nonempty single system block adds its envelope; solve the exact serialized UTF-8 boundary.
byteBoundary.system = "x";
const byteOverhead = Buffer.byteLength(JSON.stringify(prepareAnthropicRequest(byteBoundary, "1h"))) - 1;
byteBoundary.system = "x".repeat(policy.maxRequestBytes - byteOverhead);
const byteResult = await admitAnthropicReview(byteBoundary, freezeRequest(prepareAnthropicRequest(byteBoundary, "1h")), new FakeAnthropic() as never);
assert.equal(byteResult.receipt.generationRequestBytes, policy.maxRequestBytes);
reset(); await refusal("request-too-large", req => { req.system = byteBoundary.system + "x"; });
reset(); await refusal("unsupported-payload", req => { req.responseSchema = { name: "schema", schema: {} }; });
reset(); await refusal("unsupported-payload", req => { Object.assign(req, { unknownInput: "cannot be silently omitted" }); });

// A frozen request cannot be rewritten between count and dispatch; identity checks also reject a replaced body.
reset();
const mutableParams = request(), mutableBody = prepareAnthropicRequest(mutableParams, "1h");
before = async () => { mutableBody.messages[0].content = "substituted"; return null; };
await assert.rejects(() => admitAnthropicReview(mutableParams, mutableBody, new FakeAnthropic() as never), (e: unknown) => e instanceof CapacityAdmissionError && e.receipt.reason === "payload-changed");
reset();
const frozen = freezeRequest(prepareAnthropicRequest(request(), "5m"));
assert.throws(() => { frozen.messages[0].content = "substituted"; });
assert.equal(anthropicCountProjection({ ...frozen, tools: [] }), null);
assert.equal(anthropicCountProjection({ ...frozen, output_config: { ...frozen.output_config, extra: "input" } } as never), null);

// A dispatch followed by interruption remains ambiguous; never rewrite its supplied source as not dispatched.
for (const scenario of ["generation-failure", "generation-cancel", "truncated", "malformed"]) {
  reset(); mode = scenario; const attempt = prepared();
  try { await executeCoveredReview(request(attempt), attempt.coverage, "template", req => anthropicProvider.create(req, "synthetic")); } catch { /* expected interruption */ }
  assert.equal(calls.filter(call => call.operation === "generation").length, 1);
  assert.equal(attempt.coverage.assessment?.capacityAdmission?.primaryDispatch, "started");
  assert.equal(attempt.coverage.files[0].state, "supplied");
  assert.equal(attempt.coverage.assessment?.state, "incomplete");
  assert.equal(reviewCheckResult(attempt.coverage, false, 0).conclusion, "failure");
}
reset(); remaining = 60000;
const recovery = request(); delete recovery.completeReviewAdmission;
recovery.executionWindow = { jobId: "synthetic", deadlineEpochMs: Date.now() + remaining, signal: controller.signal, remainingMs: () => remaining };
await assert.rejects(() => createAiMessage(recovery, "synthetic")); assert.equal(calls.length, 0);

// Published floors, worst-case cache writes and markup remain mandatory even with BYOK or cheap catalogue rows.
const low = new Map([[policy.model, { input: 0, output: 0 }]]);
assert.equal(estimateCompleteReviewCost(low, policy.model, 330000, 64000, 2)?.estimateUsd, 11.76);
assert.ok(estimateCompleteReviewCost(low, policy.model, 330000, 64000, 1.25)!.estimateUsd < 11.76);
for (const bad of [NaN, Infinity, -1]) assert.equal(estimateCompleteReviewCost(new Map([[policy.model, { input: bad, output: 50 }]]), policy.model, 10, 10, 2), null);
assert.equal(estimateCompleteReviewCost(new Map(), policy.model, 10, 10, 2), null);
assert.equal(estimateCompleteReviewCost(low, "other-model", 10, 10, 2), null);
assert.equal(estimateCompleteReviewCost(low, policy.model, 10, 10, 2, 0.99), null);
assert.equal(estimateCompleteReviewCost(low, policy.model, 10, 10, 0.1), null);
assert.equal(estimateCompleteReviewCost(new Map([[policy.model, { input: 20, output: 100 }]]), policy.model, 330000, 64000, 2)?.estimateUsd, 23.52);
reset(); await refusal("unsupported-route", req => { req.model = "claude-fable-5-1-alias"; });

(await getModelPricing()).set(policy.model, { input: 10, output: 50 });
for (const [scenario, initialKey] of [["generation-add", ""], ["generation-remove", "synthetic-byok"], ["generation-rotate", "synthetic-byok"]]) {
  reset(); mode = scenario; org = { ...org, anthropicApiKey: initialKey, creditBalance: 100 };
  const result = await createAiMessage(request(), "synthetic");
  assert.equal(result.usedOwnKey, !!initialKey);
  charges.length = 0;
  await logAiUsage({ provider: result.provider, model: result.model, operation: "review",
    ...result.usage, usedOwnKey: result.usedOwnKey, organizationId: "synthetic" });
  assert.equal(usageRow?.usedOwnKey, !!initialKey);
  assert.equal(charges.length, initialKey ? 0 : 1);
  if (!initialKey) assert.ok(charges[0] > 0);
}
reset(); org = { ...org, anthropicApiKey: "synthetic-byok" };
const ordinary = request(); delete ordinary.completeReviewAdmission;
const ordinaryResult = await createAiMessage(ordinary, "synthetic");
assert.equal(ordinaryResult.usedOwnKey, undefined);
reset(); provider = "openrouter";
const future = Date.now() + 301000;
const epochSpy = spyOn(Date, "now").mockReturnValue(future);
try { await refusal("unsupported-route"); assert.equal(calls.length, 0); } finally { epochSpy.mockRestore(); }
console.log("PASS measured admission, immutable refusals, cost and cancellation");
