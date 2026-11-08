import { mock } from "bun:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import type { ReviewCoverage } from "../../review-coverage";

mock.module("server-only", () => ({}));
let byok = false;
let calls = 0;
const events: Array<{ tags?: Record<string, unknown>; contexts?: Record<string, Record<string, unknown>> }> = [];
mock.module("@sentry/nextjs", () => ({ captureEvent: (event: typeof events[number]) => { events.push(event); return "fixture-event"; } }));
mock.module("@octopus/db", () => ({ prisma: {
  availableModel: { findMany: async () => [] },
  organization: { findUnique: async () => ({ openaiApiKey: byok ? "fake-key" : null }) },
} }));
mock.module("@/lib/crypto", () => ({ decryptStringMaybeLegacy: (value: string) => value }));
mock.module("openai", () => ({ default: class {
  chat = { completions: { create: async () => {
    calls++;
    throw Object.assign(new Error("synthetic-route-secret", { cause: { message: "terminated", request_id: "req_syntheticroutesecret" } }), { status: 503 });
  } } };
} }));
globalThis.fetch = (() => { throw new Error("Unexpected network access"); }) as typeof fetch;
const { openaiProvider } = await import("../../providers/openai");
mock.module("@/lib/providers", () => ({ getProvider: () => openaiProvider }));
const { createAiMessage } = await import("../../ai-router");
const { executeCoveredReview } = await import("../../review-assessment");
const { applyReviewCoverage, reviewCheckResult } = await import("../../review-coverage");
const { reportBackgroundFailure } = await import("../../background-failure");
const logs: unknown[][] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => { logs.push(args); };
try {
  for (byok of [false, true]) {
    const coverage: ReviewCoverage = { version: 1, provider: "github", headSha: "a".repeat(40), baseSha: "b".repeat(40),
      reviewRequestVersion: 2, inventoryComplete: true, expectedFiles: 1, complete: true, limitations: [],
      files: [{ path: "fixture.ts", change: "modified", state: "supplied", patchSha256: null, suppliedSha256: null, suppliedChars: 1, hunks: [] }] };
    const before = calls;
    let caught: unknown;
    try { await executeCoveredReview({ model: "gpt-fixture", maxTokens: 16, messages: [{ role: "user", content: "fixture" }] }, coverage, "fixture", request => createAiMessage(request, "org")); }
    catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(calls, before + 1);
    assert.deepEqual(coverage.assessment?.failure, { stage: "generation", code: "STREAM_TERMINATED", keyOwner: byok ? "organization" : "platform", ownership: "unknown", retryability: "unknown", status: 503 });
    assert.equal(coverage.assessment?.requests[0]?.provider, "openai");
    const check = reviewCheckResult(coverage, false, 0);
    const comment = applyReviewCoverage("Assessment failed.", coverage, "fixture-attempt");
    assert.equal(check.title, "Review generation failed");
    assert.ok(comment.includes("review generation failed"));
    reportBackgroundFailure(caught, { stage: "generation", attemptId: "fixture-attempt" });
    assert.equal(events.at(-1)?.tags?.failure_code, coverage.assessment?.failure?.code);
    assert.equal(events.at(-1)?.tags?.failure_owner, "unknown");
    assert.equal(events.at(-1)?.contexts?.background_failure?.ownership, "unknown");
    assert.equal(events.at(-1)?.contexts?.background_failure?.keyOwner, byok ? "organization" : "platform");
    assert.equal(events.at(-1)?.contexts?.background_failure?.attemptId, "fixture-attempt");
    assert.doesNotMatch(inspect({ coverage, check, comment, logs, events }, { depth: 20 }), /synthetic-route-secret|req_syntheticroutesecret|fake-key/);
  }
} finally { console.error = originalError; }
console.log("PASS provider adapter and router retain safe generation evidence");
