import { mock } from "bun:test";
import "./index-github-rate-mocks";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

let started!: () => void;
const entered = new Promise<void>((resolve) => { started = resolve; });
let release!: () => void;
const released = new Promise<void>((resolve) => { release = resolve; });
let updates = 0;
let embeddings = 0;
const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  res.setHeader("content-type", "application/json");
  if (path.includes("/git/trees/")) return res.end(JSON.stringify({ tree: [{ path: "example.ts", type: "blob", sha: "synthetic", size: 20 }] }));
  if (path.endsWith("/contributors")) return res.end("[]");
  if (path.includes("/git/blobs/")) return res.end(JSON.stringify({ encoding: "base64", content: Buffer.from("export const value = 1;\n").toString("base64") }));
  if (path === "/") return res.end(JSON.stringify({ title: "qdrant - vector search engine", version: "1.18.0" }));
  if (path === "/collections" && req.method === "GET") {
    started();
    await released;
    return res.end(JSON.stringify({ result: { collections: [{ name: "code_chunks" }] }, status: "ok", time: 0 }));
  }
  if (path.startsWith("/collections/") && req.method === "PATCH") {
    updates++;
    return res.end(JSON.stringify({ result: true, status: "ok", time: 0 }));
  }
  if (path.endsWith("/embeddings")) {
    embeddings++;
    res.statusCode = 500;
    return res.end("{}");
  }
  res.statusCode = 404;
  res.end("{}");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
process.env.QDRANT_URL = `http://127.0.0.1:${address.port}`;
process.env.SELF_HOSTED = "true";
process.env.OCTOPUS_EMBED_PROVIDER = "openai";
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
process.env.OPENAI_API_KEY = "synthetic";
mock.module("server-only", () => ({}));
mock.module("@/lib/github", () => ({ getInstallationToken: async () => "synthetic", getFileContent: async () => null, getRepositoryDetails: async () => null }));
mock.module("@/lib/ai-client", () => ({ getEmbedModel: async () => null }));
mock.module("@/lib/ai-usage", () => ({ logAiUsage: async () => {} }));
mock.module("@/lib/cost", () => ({ isOrgOverSpendLimit: async () => false }));
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
    .then((stats) => ({ stats }), (error) => ({ error }));
  await entered;
  controller.abort(reason);
  const outcome = await Promise.race([result, delay(750, undefined, { ref: false }).then(() => "still-pending" as const)]);
  assert.notEqual(outcome, "still-pending");
  assert.ok(typeof outcome === "object");
  assert.ok("error" in outcome);
  assert.equal(outcome.error, reason);
  assert.equal(embeddings, 0);
  assert.equal(updates, 0);
} finally {
  release();
  globalThis.fetch = originalFetch;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
