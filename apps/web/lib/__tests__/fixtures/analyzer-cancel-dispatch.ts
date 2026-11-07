import { mock } from "bun:test";
import assert from "node:assert/strict";

const scenario = process.argv[2];
assert.ok(["during-model-selection", "pre-aborted", "normal-success", "spend-limit", "model-error"].includes(scenario));
if (scenario === "spend-limit") console.warn = () => {};
const controller = new AbortController();
let modelCalls = 0;
let usageLogs = 0;
let chunkReads = 0;
let usage: Record<string, unknown> | undefined;
mock.module("server-only", () => ({}));
mock.module("@/lib/qdrant", () => ({
  getRepoChunks: async () => { chunkReads++; return ["synthetic code"]; },
  getKnowledgeChunksByOrg: async () => [],
}));
mock.module("@/lib/cost", () => ({ isOrgOverSpendLimit: async () => scenario === "spend-limit" }));
mock.module("@/lib/ai-client", () => ({ getReviewModel: async () => {
  if (scenario === "during-model-selection") controller.abort();
  if (scenario === "model-error") throw new Error("synthetic model selection failure");
  return "synthetic-model";
} }));
mock.module("@/lib/ai-router", () => ({ createAiMessage: async () => {
  modelCalls++;
  return { provider: "mock", text: "synthetic analysis", usage: { inputTokens: 2, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
} }));
mock.module("@/lib/ai-usage", () => ({ logAiUsage: async (params: Record<string, unknown>) => { usageLogs++; usage = params; } }));
globalThis.fetch = async () => { throw new Error("unexpected external fetch"); };
const { analyzeRepository } = await import("@/lib/analyzer");
if (scenario === "pre-aborted") controller.abort();
const result = await analyzeRepository("synthetic", "fixture/repo", "synthetic-org", undefined, controller.signal).then((value) => ({ value }), (error) => ({ error }));
if (scenario === "during-model-selection" || scenario === "pre-aborted") {
  assert.ok("error" in result);
  assert.match(String(result.error), /Analysis cancelled/);
  assert.equal(modelCalls, 0);
  assert.equal(usageLogs, 0);
  if (scenario === "pre-aborted") assert.equal(chunkReads, 0);
} else if (scenario === "spend-limit") {
  assert.deepEqual(result, { value: "Skipped: monthly AI usage limit reached." });
  assert.equal(modelCalls, 0);
  assert.equal(usageLogs, 0);
  assert.equal(chunkReads, 0);
} else if (scenario === "model-error") {
  assert.ok("error" in result);
  assert.match(String(result.error), /synthetic model selection failure/);
  assert.equal(modelCalls, 0);
  assert.equal(usageLogs, 0);
} else {
  assert.deepEqual(result, { value: "synthetic analysis" });
  assert.equal(modelCalls, 1);
  assert.equal(usageLogs, 1);
  assert.equal(usage?.organizationId, "synthetic-org");
  assert.equal(usage?.operation, "analyze");
  assert.equal(usage?.inputTokens, 2);
  assert.equal(usage?.outputTokens, 1);
}
