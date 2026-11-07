import { mock } from "bun:test";
import assert from "node:assert/strict";
const scenario = process.argv[2];
assert.ok(["provider-lookup", "key-lookup", "router-pre-aborted", "normal"].includes(scenario));
const controller = new AbortController();
const reason = new DOMException("synthetic cancellation", "AbortError");
let started!: () => void;
const entered = new Promise<void>((resolve) => { started = resolve; });
let release!: () => void;
const released = new Promise<void>((resolve) => { release = resolve; });
let providerCalls = 0;
let usageLogs = 0;
let dbReads = 0;
mock.module("server-only", () => ({}));
mock.module("@/lib/qdrant", () => ({ getRepoChunks: async () => ["synthetic code"], getKnowledgeChunksByOrg: async () => [] }));
mock.module("@/lib/cost", () => ({ isOrgOverSpendLimit: async () => false }));
mock.module("@/lib/ai-client", () => ({ getReviewModel: async () => "gpt-fixture" }));
mock.module("@/lib/ai-usage", () => ({ logAiUsage: async () => { usageLogs++; } }));
mock.module("@/lib/providers", () => ({ getProvider: () => ({ create: async (_params: unknown, key: string | null, orgId: string) => {
  providerCalls++;
  assert.equal(key, "synthetic-key");
  assert.equal(orgId, "synthetic-org");
  return { provider: "openai", model: "gpt-fixture", text: "synthetic analysis", usage: { inputTokens: 2, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
} }) }));
mock.module("@octopus/db", () => ({ prisma: {
  availableModel: { findMany: async () => { dbReads++; if (scenario === "provider-lookup") { started(); await released; } return []; } },
  organization: { findUnique: async () => { if (scenario === "key-lookup") { started(); await released; } return { openaiApiKey: "synthetic-key" }; } },
} }));
globalThis.fetch = async () => { throw new Error("unexpected external fetch"); };
try {
  if (scenario === "router-pre-aborted") {
    const { createAiMessage } = await import("@/lib/ai-router");
    controller.abort(reason);
    const outcome = await createAiMessage({ model: "gpt-fixture", maxTokens: 1, messages: [] }, "synthetic-org", controller.signal).then(() => ({ ok: true }), (error) => ({ error }));
    assert.ok("error" in outcome);
    assert.equal(outcome.error, reason);
    assert.equal(dbReads, 0);
    assert.equal(providerCalls, 0);
  } else {
    const { analyzeRepository } = await import("@/lib/analyzer");
    const result = analyzeRepository("synthetic", "fixture/repo", "synthetic-org", undefined, controller.signal).then((value) => ({ value }), (error) => ({ error }));
    if (scenario !== "normal") {
      await entered;
      controller.abort(reason);
      release();
      const outcome = await result;
      assert.ok("error" in outcome);
      assert.equal(outcome.error, reason);
      assert.equal(providerCalls, 0);
      assert.equal(usageLogs, 0);
    } else {
      assert.deepEqual(await result, { value: "synthetic analysis" });
      assert.equal(providerCalls, 1);
      assert.equal(usageLogs, 1);
    }
  }
} finally { release(); }
