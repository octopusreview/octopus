import { mock } from "bun:test";
import { strict as assert } from "node:assert";
import type { ReviewCoverage } from "../../review-coverage";

mock.module("server-only", () => ({}));
// Real router, adapters and SDKs over loopback HTTP: one application attempt must be exactly one provider request.
let storedKey: string | null = null;
mock.module("@octopus/db", () => ({ prisma: {
  availableModel: { findMany: async () => [] },
  organization: { findUnique: async () => ({ openaiApiKey: storedKey, anthropicApiKey: null }) },
} }));
mock.module("@/lib/crypto", () => ({ decryptStringMaybeLegacy: (value: string) => value }));
let requests = 0;
let responses: Array<{ status: number; headers?: Record<string, string> }> = [];
const server = Bun.serve({ port: 0, fetch() {
  requests++;
  const next = responses.shift() ?? { status: 503 };
  if (next.status !== 200) return Response.json({ error: { message: "synthetic-route-secret", type: "error" } }, { status: next.status, headers: { "retry-after-ms": "1", ...next.headers } });
  return Response.json({ model: "gpt-fixture", choices: [{ message: { content: "emulated" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
} });
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.port}/v1`;
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.port}`;
process.env.OPENAI_API_KEY = process.env.ANTHROPIC_API_KEY = "synthetic-platform-key";
const { createAiMessage, credentialRouteUnchanged } = await import("../../ai-router");
const { AiProviderFailure, classifyFailure } = await import("../../provider-failure");
const { executeCoveredReview } = await import("../../review-assessment");
const originalError = console.error;
console.error = () => {};
const failed = async (model: string, extra: { maxRetries?: 0 } = {}) => {
  const before = requests;
  try { await createAiMessage({ model, maxTokens: 16, messages: [{ role: "user", content: "fixture" }], ...extra }, "org"); assert.fail("expected a provider failure"); }
  catch (error) { assert.ok(error instanceof AiProviderFailure); return { error, requests: requests - before }; }
};
try {
  for (const model of ["gpt-fixture", "claude-fixture"]) {
    responses = [];
    assert.equal((await failed(model)).requests, 3, `${model}: the SDK retries a 503 by default`);
    assert.equal((await failed(model, { maxRetries: 0 })).requests, 1, `${model}: the review path sends exactly one request per attempt`);
  }

  responses = [{ status: 429, headers: { "retry-after": "7" } }];
  const limited = await failed("gpt-fixture", { maxRetries: 0 });
  assert.equal(limited.requests, 1);
  assert.equal(limited.error.retryAfterMs, 7000, "Retry-After survives as a number only");
  assert.deepEqual(classifyFailure(limited.error.details, limited.error.keyOwner, "generation"), { code: "http_429", ownership: "platform", retryability: "transient" });
  assert.doesNotMatch(JSON.stringify(limited.error) + limited.error.message, /synthetic-route-secret|synthetic-platform-key/);

  // The pre-retry route check compares the credential in memory only.
  assert.equal(await credentialRouteUnchanged(limited.error, "org"), true);
  storedKey = "synthetic-organization-key";
  assert.equal(await credentialRouteUnchanged(limited.error, "org"), false, "an added organization key changes the route");
  const owned = await failed("gpt-fixture", { maxRetries: 0 });
  assert.equal(owned.error.keyOwner, "organization");
  assert.equal(await credentialRouteUnchanged(owned.error, "org"), true);
  storedKey = "synthetic-replacement-key";
  assert.equal(await credentialRouteUnchanged(owned.error, "org"), false, "a replaced key changes the route");
  assert.equal(await credentialRouteUnchanged(new AiProviderFailure(new Error("fixture"), "openai", "gpt-fixture", "organization"), "org"), false, "an unobserved failure proves nothing");
  storedKey = null;

  // Two application attempts are exactly two provider requests.
  const coverage: ReviewCoverage = { version: 1, provider: "github", headSha: "a".repeat(40), baseSha: "b".repeat(40),
    reviewRequestVersion: 2, inventoryComplete: true, expectedFiles: 1, complete: true, limitations: [],
    files: [{ path: "fixture.ts", change: "modified", state: "supplied", patchSha256: null, suppliedSha256: null, suppliedChars: 1, hunks: [] }] };
  const window = { jobId: "fixture", deadlineEpochMs: Date.now() + 900000, signal: new AbortController().signal, remainingMs: () => 900000 };
  let confirmations = 0;
  responses = [{ status: 503 }, { status: 200 }];
  const before = requests;
  const response = await executeCoveredReview({ model: "gpt-fixture", maxTokens: 16, maxRetries: 0, messages: [{ role: "user", content: "fixture" }] }, coverage, "fixture",
    request => createAiMessage(request, "org"), { window, confirm: async failure => { confirmations++; return credentialRouteUnchanged(failure, "org"); } });
  assert.equal(response.provider, "openai");
  assert.equal(requests - before, 2);
  assert.equal(confirmations, 1);
  assert.deepEqual(coverage.assessment?.attempts?.map(attempt => [attempt.failure.code, attempt.requests.length]), [["http_503", 1]]);
  assert.equal(coverage.assessment?.requests.length, 1);
  assert.equal(coverage.assessment?.failure, undefined);

  const controller = new AbortController();
  const cancellableWindow = { ...window, signal: controller.signal };
  let retrySignal: AbortSignal | undefined;
  let callCount = 0;
  const cancelled = structuredClone(coverage); delete cancelled.assessment;
  await assert.rejects(() => executeCoveredReview({ model: "gpt-fixture", maxTokens: 16, maxRetries: 0, messages: [{ role: "user", content: "fixture" }] }, cancelled, "fixture",
    async request => {
      if (++callCount === 1) throw new AiProviderFailure(new Error("terminated"), "openai", "gpt-fixture", "platform");
      retrySignal = request.signal;
      controller.abort();
      throw new Error("aborted");
    }, { window: cancellableWindow, confirm: async () => true }));
  assert.equal(callCount, 2);
  assert.equal(retrySignal?.aborted, true, "the dispatched retry receives the job cancellation signal");

  const originalFetch = globalThis.fetch;
  const sdkAbort = new AbortController();
  let sdkSignal: AbortSignal | null | undefined;
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    sdkSignal = init?.signal;
    sdkAbort.abort();
    return Promise.reject(new DOMException("cancelled", "AbortError"));
  }) as typeof fetch;
  try {
    await assert.rejects(() => createAiMessage({ model: "gpt-fixture", maxTokens: 16, maxRetries: 0, signal: sdkAbort.signal, messages: [{ role: "user", content: "fixture" }] }, "org"));
    assert.equal(sdkSignal?.aborted, true, "the OpenAI SDK receives and honors the request signal");
  } finally { globalThis.fetch = originalFetch; }

  // A retry refused before dispatch leaves the original classified failure, and the supplied input, standing.
  const { CapacityAdmissionError, capacityReceipt } = await import("../../review-capacity");
  const refusal = new CapacityAdmissionError({ ...capacityReceipt({ candidateSha256: "c".repeat(64), preparedSource: { chars: 1, files: 1, hunks: 0 },
    headSha: "a".repeat(40), baseSha: "b".repeat(40), reviewRequestVersion: 2, window, beforeGeneration: async () => null }, "gpt-fixture"), reason: "stale-review" });
  const original = new AiProviderFailure(new Error("terminated"), "openai", "gpt-fixture", "platform");
  const refused = structuredClone(coverage); delete refused.assessment;
  let calls = 0;
  await assert.rejects(() => executeCoveredReview({ model: "gpt-fixture", maxTokens: 16, maxRetries: 0, messages: [{ role: "user", content: "fixture" }] }, refused, "fixture",
    async () => { throw calls++ ? refusal : original; }, { window, confirm: async () => true }), error => error === original);
  assert.equal(calls, 2);
  assert.deepEqual([refused.assessment?.failure?.code, refused.assessment?.attempts, refused.assessment?.capacityAdmission], ["STREAM_TERMINATED", undefined, undefined]);
  assert.deepEqual([refused.complete, refused.files[0].state], [true, "supplied"]);
} finally { console.error = originalError; server.stop(true); }
console.log("PASS one review attempt is one provider request");
