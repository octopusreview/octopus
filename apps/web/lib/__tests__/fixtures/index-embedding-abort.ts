import { mock } from "bun:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

const scenario = process.argv[2];
assert.ok(["openai-headers", "openai-body", "openai-success", "ollama-headers", "ollama-body", "ollama-success"].includes(scenario));
const provider = scenario.split("-")[0];
let started!: () => void;
const entered = new Promise<void>(resolve => { started = resolve; });
let embedRequests = 0;
const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  if (path.includes("/git/trees/")) return res.end(JSON.stringify({ tree: [{ path: "example.ts", type: "blob", sha: "synthetic", size: 20 }] }));
  if (path.endsWith("/contributors")) return res.end("[]");
  if (path.includes("/git/blobs/")) return res.end(JSON.stringify({ encoding: "base64", content: Buffer.from("export const value = 1;\n").toString("base64") }));
  if (path.endsWith("/embeddings") || path.endsWith("/api/embed")) {
    embedRequests++;
    if (scenario.endsWith("headers")) { started(); return; }
    if (scenario.endsWith("body")) { res.write('{"partial":'); started(); return; }
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify(provider === "openai"
      ? { data: [{ embedding: Buffer.from(new Float32Array([0.1]).buffer).toString("base64"), index: 0 }], usage: { prompt_tokens: 1, total_tokens: 1 } }
      : { embeddings: [[0.1]] }));
  }
  res.statusCode = 404;
  res.end();
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
process.env.OCTOPUS_EMBED_PROVIDER = provider;
process.env.OCTOPUS_EMBED_MODEL = "synthetic";
process.env.OCTOPUS_EMBED_DIM = "1";
process.env.OCTOPUS_OLLAMA_BASE_URL = `http://127.0.0.1:${address.port}`;
process.env.SELF_HOSTED = "true";
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
process.env.OPENAI_API_KEY = "synthetic";
mock.module("server-only", () => ({}));
mock.module("@/lib/github", () => ({ getInstallationToken: async () => "synthetic", getFileContent: async () => null, getRepositoryDetails: async () => null }));
mock.module("@/lib/ai-client", () => ({ getEmbedModel: async () => null }));
mock.module("@/lib/ai-usage", () => ({ logAiUsage: async () => {} }));
mock.module("@/lib/cost", () => ({ isOrgOverSpendLimit: async () => false }));
let upserts = 0;
mock.module("@/lib/qdrant", () => ({ ensureCollection: async () => {}, upsertChunks: async () => { upserts++; }, deleteRepoFileChunks: async () => {} }));
const originalFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "api.github.com") return originalFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, String(address.port));
  return originalFetch(input, init);
}) as typeof fetch;
try {
  const { indexRepository } = await import("@/lib/indexer");
  const controller = new AbortController();
  const reason = new DOMException("synthetic deadline", "TimeoutError");
  const result = indexRepository({ repoId: "synthetic", indexAttemptId: "synthetic" }, "fixture/repo", "main", 1, undefined, controller.signal, "github", "synthetic", "fixture")
    .then(stats => ({ stats }), error => ({ error }));
  if (scenario.endsWith("success")) {
    const outcome = await result;
    assert.ok("stats" in outcome, "error" in outcome ? String(outcome.error) : "missing stats");
    assert.equal(outcome.stats.indexedFiles, 1);
    assert.equal(upserts, 1);
  } else {
    await entered;
    await delay(50);
    controller.abort(reason);
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([result, new Promise<"stalled">(resolve => { watchdog = setTimeout(() => resolve("stalled"), 700); })]);
    clearTimeout(watchdog);
    assert.notEqual(outcome, "stalled");
    assert.ok(typeof outcome === "object" && "error" in outcome);
    assert.equal(outcome.error, reason);
    assert.equal(upserts, 0);
    await delay(1_100);
  }
  assert.equal(embedRequests, 1);
} finally {
  globalThis.fetch = originalFetch;
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
