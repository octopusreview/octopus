import { mock } from "bun:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";

mock.module("server-only", () => ({}));
let failure: unknown = new Error("synthetic-provider-secret");
let repositoryExists = true;
class ReviewConfigError extends Error {}
const review = async () => {
  if (failure !== null) throw failure;
  return { findings: [], summary: "ok", model: "synthetic", usage: {} };
};
mock.module("@/lib/api-auth", () => ({ authenticateApiToken: async () => ({ org: { id: "org" }, user: null }) }));
mock.module("@/lib/cost", () => ({ isOrgOverSpendLimit: async () => false }));
mock.module("@/lib/audit", () => ({ writeAuditLog: async () => {} }));
mock.module("@/lib/external-review-activity", () => ({ withExternalReviewActivity: async (_input: unknown, fn: () => Promise<Response>) => fn() }));
mock.module("@/lib/review-core", () => ({ ReviewConfigError, generateLocalReview: review, generateBareLocalReview: review }));
mock.module("@octopus/db", () => ({ prisma: { repository: { findFirst: async () => repositoryExists ? { id: "repo" } : null } } }));
mock.module("next/headers", () => ({ headers: async () => new Headers() }));

const { NextRequest } = await import("next/server");
const bare = await import("../../../app/api/cli/review-local/route");
const contextual = await import("../../../app/api/cli/repos/[id]/local-review/route");
const { EmbeddingDimensionError, MissingEmbeddingKeyError, OllamaEmbeddingResponseError, OllamaEmbeddingUrlError } = await import("../../embedding-error");
const { AiProviderFailure } = await import("../../provider-failure");
const calls = [
  () => bare.POST(new NextRequest("http://localhost/api/cli/review-local", { method: "POST", body: JSON.stringify({ diff: "+test" }) })),
  () => contextual.POST(new NextRequest("http://localhost/api/cli/repos/repo/local-review", { method: "POST", body: JSON.stringify({ diff: "+test" }) }), { params: Promise.resolve({ id: "repo" }) }),
];
const logs: unknown[][] = [];
console.error = (...args: unknown[]) => { logs.push(args); };

for (const call of calls) {
  for (const value of [Object.assign(new Error("synthetic-provider-secret"), { status: 503, request_id: "req_syntheticsecret123" }), { message: "synthetic-provider-secret", cause: { token: "synthetic-provider-secret" } }, new Error("Set OPENAI_API_KEY synthetic-provider-secret")]) {
    failure = value;
    const response = await call();
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Review generation failed" });
    assert.ok(!inspect(logs, { depth: 10 }).includes("synthetic-provider-secret"));
  }
  assert.ok(inspect(logs).includes("503"));
  assert.ok(!inspect(logs).includes("req_syntheticsecret123"));
  for (const status of [401, 503]) {
    failure = Object.assign(new Error("Ollama embeddings request failed"), { status, request_id: "synthetic-provider-secret" });
    const response = await call();
    assert.deepEqual(await response.json(), { error: "Review generation failed" });
    assert.deepEqual(logs.at(-1)?.[1], { name: "Error", status });
  }
  failure = new EmbeddingDimensionError(2, 3);
  failure.message = "synthetic-provider-secret";
  const dimensionResponse = await call();
  assert.deepEqual(logs.at(-1)?.[1], { name: "Error", category: "embedding_dimension_mismatch" });
  assert.equal(dimensionResponse.status, 500);
  assert.deepEqual(await dimensionResponse.json(), { error: process.env.NODE_ENV === "development"
    ? "Embedding returned 2 dimensions; OCTOPUS_EMBED_DIM is 3. Check the embedding model and configured dimension."
    : "Review generation failed" });
  failure = new MissingEmbeddingKeyError();
  failure.message = "synthetic-provider-secret";
  const keyResponse = await call();
  assert.deepEqual(logs.at(-1)?.[1], { name: "Error", category: "embedding_key_missing" });
  assert.equal(keyResponse.status, 500);
  assert.deepEqual(await keyResponse.json(), { error: process.env.NODE_ENV === "development"
    ? "Set OPENAI_API_KEY to configure OpenAI embeddings." : "Review generation failed" });
  failure = new OllamaEmbeddingResponseError();
  failure.message = "synthetic-provider-secret";
  const ollamaResponse = await call();
  assert.deepEqual(logs.at(-1)?.[1], { name: "Error", category: "ollama_embedding_response_invalid" });
  assert.equal(ollamaResponse.status, 500);
  assert.deepEqual(await ollamaResponse.json(), { error: process.env.NODE_ENV === "development"
    ? "Check that the configured embedding model is pulled on the Ollama server." : "Review generation failed" });
  failure = new OllamaEmbeddingUrlError();
  failure.message = "synthetic-provider-secret";
  const urlResponse = await call();
  assert.deepEqual(logs.at(-1)?.[1], { name: "Error", category: "ollama_embedding_url_invalid" });
  assert.equal(urlResponse.status, 500);
  assert.deepEqual(await urlResponse.json(), { error: process.env.NODE_ENV === "development"
    ? "Configured Ollama embedding URL was rejected; check the URL and deployment network policy. For a self-hosted deployment, set SELF_HOSTED=true if local access is intentional." : "Review generation failed" });
  failure = new Error("Configured Ollama embedding URL was rejected; synthetic-provider-secret");
  const spoofedResponse = await call();
  assert.deepEqual(logs.at(-1)?.[1], { name: "Error" });
  assert.equal(spoofedResponse.status, 500);
  assert.deepEqual(await spoofedResponse.json(), { error: "Review generation failed" });
  failure = new AiProviderFailure({ status: 503, request_id: "req_syntheticsecret123", message: "synthetic-provider-secret" }, "openai", "model", "unknown");
  await call();
  assert.deepEqual(logs.at(-1)?.[1], { name: "Error", status: 503 });
  Object.assign(failure.details, { status: 999, requestId: "synthetic-provider-secret", code: "synthetic-provider-secret" });
  await call();
  assert.deepEqual(logs.at(-1)?.[1], { name: "Error" });
  failure = new EmbeddingDimensionError(Number.MAX_SAFE_INTEGER, 3);
  const invalidResponse = await call();
  assert.deepEqual(await invalidResponse.json(), { error: process.env.NODE_ENV === "development"
    ? "Embedding dimensions do not match OCTOPUS_EMBED_DIM. Check the embedding model and configured dimension."
    : "Review generation failed" });
  assert.ok(!inspect(logs, { depth: 10 }).includes("synthetic-provider-secret"));
  failure = new ReviewConfigError("Safe configuration advice");
  const response = await call();
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { error: "Safe configuration advice" });
  failure = null;
  assert.equal((await call()).status, 200);
}
repositoryExists = false;
assert.equal((await calls[1]()).status, 404);
