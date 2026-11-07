import { mock } from "bun:test";
import assert from "node:assert/strict";

const scenario = process.argv[2];
assert.ok(["openai-batch", "openai-split-cancel", "openai-split-success", "ollama-batch", "tracked-over-limit", "tracked-signal-refused", "pre-aborted"].includes(scenario));
const controller = new AbortController();
const reason = new DOMException("synthetic deadline", "TimeoutError");
process.env.OCTOPUS_EMBED_PROVIDER = scenario === "ollama-batch" ? "ollama" : "openai";
process.env.OCTOPUS_EMBED_MODEL = "synthetic";
process.env.OCTOPUS_EMBED_DIM = "1";
process.env.OCTOPUS_OLLAMA_BASE_URL = "http://127.0.0.1:1";
process.env.SELF_HOSTED = "true";
mock.module("server-only", () => ({}));
mock.module("@/lib/ai-client", () => ({ getEmbedModel: async () => "synthetic" }));
let usageCalls = 0;
let usageRecord: { inputTokens: number; organizationId: string; provider: string } | undefined;
mock.module("@/lib/ai-usage", () => ({ logAiUsage: async (record: typeof usageRecord) => { usageCalls++; usageRecord = record; } }));
mock.module("@/lib/cost", () => ({ isOrgOverSpendLimit: async () => scenario === "tracked-over-limit" }));
let requests = 0;
class SyntheticAPIError extends Error { status = 400; }
class SyntheticOpenAI {
  static APIError = SyntheticAPIError;
  embeddings = { create: async ({ input }: { input: string[] }, options?: { signal?: AbortSignal }) => {
    requests++;
    if (scenario === "openai-batch") { assert.equal(options?.signal, controller.signal); controller.abort(reason); }
    if (scenario === "openai-split-cancel") { assert.equal(options?.signal, controller.signal); controller.abort(reason); throw new SyntheticAPIError("maximum request size"); }
    if (scenario === "openai-split-success" && requests === 1) throw new SyntheticAPIError("maximum request size");
    return { data: input.map(() => ({ embedding: [0.1] })), usage: { prompt_tokens: 1 } };
  } };
}
mock.module("openai", () => ({ default: SyntheticOpenAI }));
globalThis.fetch = (async () => {
  assert.equal(scenario, "ollama-batch");
  requests++;
  return { ok: true, json: async () => { controller.abort(reason); return { embeddings: Array.from({ length: 64 }, () => [0.1]) }; } } as Response;
}) as typeof fetch;
const { createEmbeddings } = await import("@/lib/embeddings");
if (scenario === "openai-split-success") {
  const vectors = await createEmbeddings(["a", "b"], { organizationId: "synthetic", operation: "embedding" });
  assert.equal(vectors.length, 2);
  assert.equal(requests, 3);
  assert.equal(usageCalls, 1);
  assert.equal(usageRecord?.inputTokens, 2);
  assert.equal(usageRecord?.organizationId, "synthetic");
  assert.equal(usageRecord?.provider, "openai");
} else if (scenario === "tracked-over-limit") {
  const vectors = await createEmbeddings(["a"], { organizationId: "synthetic", operation: "embedding" });
  assert.deepEqual(vectors, [[]]);
  assert.equal(requests, 0);
  assert.equal(usageCalls, 0);
} else if (scenario === "tracked-signal-refused") {
  await assert.rejects(() => createEmbeddings(["synthetic"], { organizationId: "synthetic", operation: "embedding" }, controller.signal), /Cancellation is not supported for tracked embeddings/);
  assert.equal(requests, 0);
  assert.equal(usageCalls, 0);
} else if (scenario === "pre-aborted") {
  controller.abort(reason);
  await assert.rejects(() => createEmbeddings(["synthetic"], undefined, controller.signal), error => error === reason);
  assert.equal(requests, 0);
  assert.equal(usageCalls, 0);
} else {
  const count = scenario === "ollama-batch" ? 65 : scenario === "openai-batch" ? 513 : 2;
  await assert.rejects(() => createEmbeddings(Array(count).fill("synthetic"), undefined, controller.signal), error => error === reason);
  assert.equal(requests, 1);
  assert.equal(usageCalls, 0);
}
