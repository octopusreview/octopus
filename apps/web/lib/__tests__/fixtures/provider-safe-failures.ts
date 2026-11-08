import { mock } from "bun:test";
import assert from "node:assert/strict";

const secret = "synthetic-provider-secret";
let provider = "openai";
mock.module("server-only", () => ({}));
mock.module("@/lib/ai-usage", () => ({ logAiUsage: async () => {} }));
mock.module("@/lib/ai-client", () => ({ getEmbedModel: async () => "model" }));
mock.module("@/lib/cost", () => ({ isOrgOverSpendLimit: async () => false }));
mock.module("@/lib/embed-config", () => ({ getEmbedConfig: () => ({ provider, model: "model", dim: 3, ollamaBaseUrl: "http://localhost:11434" }) }));
mock.module("@/lib/providers/url-validation", () => ({ validateProviderUrl: (url: string) => url }));
mock.module("openai", () => ({ default: class { embeddings = { create: async () => ({ data: [{ embedding: [1, 2] }], usage: { prompt_tokens: 1 } }) }; } }));
mock.module("cohere-ai", () => ({ CohereClient: class { v2 = { rerank: async () => { throw { message: secret, cause: { response: secret, status: 503 } }; } }; } }));
globalThis.fetch = async () => Response.json({ embeddings: [[1, 2]] });
process.env.COHERE_API_KEY = "synthetic";
const { createEmbeddings } = await import("../../embeddings");
const { EmbeddingDimensionError } = await import("../../embedding-error");
for (provider of ["openai", "ollama"]) {
  await assert.rejects(createEmbeddings(["text"]), EmbeddingDimensionError);
}
const { rerankDocuments } = await import("../../reranker");
const warnings: unknown[][] = [];
console.warn = (...args) => { warnings.push(args); };
const documents = [{ text: "first" }, { text: "second" }, { text: "third" }];
assert.deepEqual(await rerankDocuments("query", documents, { organizationId: "org", operation: "test", topK: 2 }), documents.slice(0, 2));
assert.equal(warnings.length, 1);
assert.equal(JSON.stringify(warnings).includes(secret), false);
assert.deepEqual(warnings[0][1], { name: "Error", status: 503 });
