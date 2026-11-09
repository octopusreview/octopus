import { mock } from "bun:test";
import "./index-github-rate-mocks";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

const scenario = process.argv[2];
assert.ok(["cancel", "cancel-body-reason", "timeout", "success", "retry", "cancel-retry"].includes(scenario));
mock.module("server-only", () => ({}));
mock.module("@/lib/github", () => ({ getInstallationToken: async () => "fixture", getFileContent: async () => null, getRepositoryDetails: async () => null }));
let upserts = 0;
let embeddings = 0;
mock.module("@/lib/qdrant", () => ({ ensureCollection: async () => {}, upsertChunks: async () => { upserts++; }, deleteRepoFileChunks: async () => {} }));
mock.module("@/lib/embeddings", () => ({ createEmbeddings: async (texts: string[]) => { embeddings++; return texts.map(() => [0.1]); } }));
let entered!: () => void;
const started = new Promise<void>(resolve => { entered = resolve; });
let blobRequests = 0;
const server = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url?.includes("/git/trees/")) return res.end(JSON.stringify({ tree: [{ path: "src/example.ts", type: "blob", sha: "synthetic", size: 20 }] }));
  if (req.url?.includes("/contributors")) return res.end("[]");
  if (req.url?.includes("/git/blobs/")) {
    blobRequests++;
    if ((scenario === "retry" || scenario === "cancel-retry") && blobRequests === 1) {
      res.statusCode = 403;
      entered();
      return res.end('{}');
    }
    if (scenario === "success" || scenario === "retry") return res.end('{"encoding":"base64","content":"Y29uc3QgeCA9IDE7"}');
    res.write('{"encoding":"base64","content":"');
    entered();
    return;
  }
  res.statusCode = 404;
  res.end();
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const originalFetch = globalThis.fetch;
const originalTimeout = AbortSignal.timeout;
if (scenario.includes("timeout")) {
  AbortSignal.timeout = (milliseconds: number) => originalTimeout(milliseconds === 30_000 ? 150 : milliseconds);
}
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(url.hostname, "api.github.com");
  return originalFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init);
}) as typeof fetch;
try {
  const { indexRepository } = await import("@/lib/indexer");
  const controller = new AbortController();
  const timeoutReason = new DOMException("synthetic deadline", "TimeoutError");
  const result = indexRepository({ repoId: "synthetic", indexAttemptId: "synthetic" }, "fixture/repo", "main", 1, undefined, controller.signal, "github", "synthetic", "fixture")
    .then(stats => ({ stats }), error => ({ error }));
  if (scenario === "success" || scenario === "retry") {
    const outcome = await result;
    assert.ok("stats" in outcome);
    assert.equal(outcome.stats.indexedFiles, 1);
    assert.equal(embeddings, 1);
    assert.equal(upserts, 1);
    assert.equal(blobRequests, scenario === "retry" ? 2 : 1);
  } else {
    await started;
    if (scenario.startsWith("cancel")) {
      await delay(50);
      controller.abort(scenario.endsWith("reason") ? timeoutReason : undefined);
    }
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([result, new Promise<"stalled">(resolve => { watchdog = setTimeout(() => resolve("stalled"), 2_000); })]);
    clearTimeout(watchdog);
    assert.notEqual(outcome, "stalled");
    assert.ok(typeof outcome === "object" && "error" in outcome);
    if (scenario.endsWith("reason")) assert.equal(outcome.error, timeoutReason);
    assert.equal(embeddings, 0);
    assert.equal(upserts, 0);
    assert.equal(blobRequests, 1);
  }
} finally {
  globalThis.fetch = originalFetch;
  AbortSignal.timeout = originalTimeout;
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
