import { mock } from "bun:test";
import assert from "node:assert/strict";

const secret = "synthetic-provider-secret";
let provider = "openai";
let vector = [1, 2];
mock.module("server-only", () => ({}));
mock.module("@/lib/ai-usage", () => ({ logAiUsage: async () => {} }));
mock.module("@/lib/ai-client", () => ({ getEmbedModel: async () => "model" }));
mock.module("@/lib/cost", () => ({ isOrgOverSpendLimit: async () => false }));
mock.module("@/lib/embed-config", () => ({ getEmbedConfig: () => ({ provider, model: "model", dim: 3, ollamaBaseUrl: "http://localhost:11434" }) }));
mock.module("@/lib/providers/url-validation", () => ({ validateProviderUrl: (url: string) => url }));
mock.module("openai", () => ({ default: class { embeddings = { create: async () => ({ data: [{ embedding: vector }], usage: { prompt_tokens: 1 } }) }; } }));
mock.module("cohere-ai", () => ({ CohereClient: class { v2 = { rerank: async () => { throw { message: secret, cause: { response: secret, status: 503 } }; } }; } }));
globalThis.fetch = async () => Response.json({ embeddings: [vector] });
process.env.COHERE_API_KEY = "synthetic";
const { createEmbeddings } = await import("../../embeddings");
const { EmbeddingDimensionError, MissingEmbeddingKeyError } = await import("../../embedding-error");
delete process.env.OPENAI_API_KEY;
await assert.rejects(createEmbeddings(["text"]), MissingEmbeddingKeyError);
process.env.OPENAI_API_KEY = "synthetic-key";
for (provider of ["openai", "ollama"]) {
  await assert.rejects(createEmbeddings(["text"]), (error: unknown) => {
    assert.ok(error instanceof EmbeddingDimensionError);
    assert.equal(error.actual, 2);
    assert.equal(error.configured, 3);
    return true;
  });
  vector = [1, 2, 3];
  assert.deepEqual(await createEmbeddings(["text"]), [[1, 2, 3]]);
  vector = [1, 2];
}
const controller = new AbortController();
controller.abort();
await assert.rejects(createEmbeddings(["text"], undefined, controller.signal), { name: "AbortError" });
const { rerankDocuments } = await import("../../reranker");
const warnings: unknown[][] = [];
console.warn = (...args) => { warnings.push(args); };
const documents = [{ text: "first" }, { text: "second" }, { text: "third" }];
assert.deepEqual(await rerankDocuments("query", documents, { organizationId: "org", operation: "test", topK: 2 }), documents.slice(0, 2));
assert.equal(warnings.length, 1);
assert.equal(JSON.stringify(warnings).includes(secret), false);
assert.deepEqual(warnings[0][1], { name: "Error", status: 503 });
