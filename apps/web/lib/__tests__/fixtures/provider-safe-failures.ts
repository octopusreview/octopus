import { mock } from "bun:test";
import assert from "node:assert/strict";

const secret = "synthetic-provider-secret";
let provider = "openai";
let vector = [1, 2];
let malformed = false;
let ollamaUrl = "https://example.com";
let fetchCount = 0;
mock.module("server-only", () => ({}));
mock.module("@/lib/ai-usage", () => ({ logAiUsage: async () => {} }));
mock.module("@/lib/ai-client", () => ({ getEmbedModel: async () => "model" }));
mock.module("@/lib/cost", () => ({ isOrgOverSpendLimit: async () => false }));
mock.module("@/lib/embed-config", () => ({ getEmbedConfig: () => ({ provider, model: "model", dim: 3, ollamaBaseUrl: ollamaUrl }) }));
mock.module("openai", () => ({ default: class { embeddings = { create: async () => ({ data: [{ embedding: vector }], usage: { prompt_tokens: 1 } }) }; } }));
mock.module("cohere-ai", () => ({ CohereClient: class { v2 = { rerank: async () => { throw { message: secret, cause: { response: secret, status: 503 } }; } }; } }));
globalThis.fetch = async () => { fetchCount++; return Response.json(malformed ? { embeddings: [] } : { embeddings: [vector] }); };
delete process.env.SELF_HOSTED;
process.env.COHERE_API_KEY = "synthetic";
const { createEmbeddings } = await import("../../embeddings");
const { EmbeddingDimensionError, OllamaEmbeddingResponseError, OllamaEmbeddingUrlError } = await import("../../embedding-error");
delete process.env.OPENAI_API_KEY;
await assert.rejects(createEmbeddings(["text"]), { name: "MissingEmbeddingKeyError", message: "Set OPENAI_API_KEY to configure OpenAI embeddings." });
process.env.OPENAI_API_KEY = "synthetic-key";
for (provider of ["openai", "ollama"]) {
  await assert.rejects(createEmbeddings(["text"]), (error: unknown) => {
    assert.ok(error instanceof EmbeddingDimensionError);
    assert.equal(error.actual, 2);
    assert.equal(error.configured, 3);
    assert.match(error.message, /returned 2 dimensions; OCTOPUS_EMBED_DIM is 3/);
    return true;
  });
  vector = [1, 2, 3];
  assert.deepEqual(await createEmbeddings(["text"]), [[1, 2, 3]]);
  vector = [1, 2];
}
provider = "ollama";
malformed = true;
await assert.rejects(createEmbeddings(["text"]), (error: unknown) => {
  assert.ok(error instanceof OllamaEmbeddingResponseError);
  assert.equal(error.message, "Check the configured embedding model and the Ollama server response.");
  return true;
});
malformed = false;
const beforeRejected = fetchCount;
for (ollamaUrl of ["http://127.0.0.1:11434", "not-a-url-synthetic-provider-secret"]) {
  await assert.rejects(createEmbeddings(["text"]), (error: unknown) => {
    assert.ok(error instanceof OllamaEmbeddingUrlError);
    assert.equal(error.message, "Configured Ollama embedding URL was rejected; check URL and deployment network settings.");
    return true;
  });
}
assert.equal(fetchCount, beforeRejected);
ollamaUrl = "https://example.com";
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
