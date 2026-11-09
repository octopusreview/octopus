import { mock } from "bun:test";
import "./index-github-rate-mocks";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

const scenario = process.argv[2];
assert.ok(["ignore-headers", "ignore-body", "ignore-backoff", "details-headers", "details-body", "details-backoff", "ignore-success", "details-success", "details-retry-success", "details-retry-no-signal"].includes(scenario));
mock.module("server-only", () => ({}));
mock.module("@/lib/github-app-config", () => ({ getGithubAppConfig: async () => null }));
let upserts = 0;
let embeddings = 0;
const indexedPaths: string[] = [];
mock.module("@/lib/qdrant", () => ({ ensureCollection: async () => {}, upsertChunks: async (points: { payload: { filePath: string } }[]) => { upserts++; indexedPaths.push(...points.map(point => point.payload.filePath)); }, deleteRepoFileChunks: async () => {} }));
mock.module("@/lib/embeddings", () => ({ createEmbeddings: async (texts: string[]) => { embeddings++; return texts.map(() => [1]); } }));
let entered!: () => void;
const started = new Promise<void>(resolve => { entered = resolve; });
let metadataRequests = 0;
const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  const detailsScenario = scenario.startsWith("details");
  if (path.includes("/git/trees/")) {
    if (detailsScenario && path.endsWith("/main")) { res.statusCode = 404; return res.end("{}"); }
    const tree = detailsScenario ? [] : [{ path: ".octopusignore", type: "blob", sha: "fixture", size: 10 }];
    if (scenario === "ignore-success") tree.push(
      { path: "ignored.ts", type: "blob", sha: "ignored", size: 20 },
      { path: "kept.ts", type: "blob", sha: "kept", size: 20 },
    );
    return res.end(JSON.stringify({ tree }));
  }
  if (path.endsWith("/contributors")) return res.end("[]");
  if (path.includes("/git/blobs/")) return res.end(JSON.stringify({ encoding: "base64", content: Buffer.from("export const value = 1;\n").toString("base64") }));
  if (path.endsWith("/contents/.octopusignore") || path === "/repos/fixture/repo") {
    metadataRequests++;
    if (scenario.endsWith("headers")) { entered(); return; }
    if (scenario.endsWith("body")) { res.write(detailsScenario ? '{"default_branch":' : "# partial"); entered(); return; }
    if (scenario.endsWith("backoff")) { res.statusCode = 503; res.end("{}"); entered(); return; }
    if (scenario.startsWith("details-retry") && metadataRequests === 1) { res.statusCode = 503; return res.end("{}"); }
    return res.end(detailsScenario ? JSON.stringify({ id: 1, name: "repo", full_name: "fixture/repo", private: false, default_branch: "other", html_url: "" }) : "ignored.ts\n");
  }
  res.statusCode = 404;
  res.end();
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const originalFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(url.hostname, "api.github.com");
  return originalFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init);
}) as typeof fetch;
try {
  if (scenario === "details-retry-no-signal") {
    const { getRepositoryDetails } = await import("@/lib/github");
    const details = await getRepositoryDetails(1, "fixture", "repo", "fixture");
    assert.equal(details?.default_branch, "other");
    assert.equal(metadataRequests, 2);
  } else {
    const { indexRepository } = await import("@/lib/indexer");
    const controller = new AbortController();
    const result = indexRepository({ repoId: "synthetic", indexAttemptId: "synthetic" }, "fixture/repo", "main", 1, undefined, controller.signal, "github", "synthetic", "fixture")
      .then(stats => ({ stats }), error => ({ error }));
    if (scenario.endsWith("success")) {
      const outcome = await result;
      assert.ok("stats" in outcome);
      if (scenario.startsWith("details")) assert.equal(outcome.stats.resolvedDefaultBranch, "other");
      if (scenario === "ignore-success") {
        assert.equal(outcome.stats.indexedFiles, 1);
        assert.deepEqual(indexedPaths, ["kept.ts"]);
      }
      assert.equal(metadataRequests, scenario === "details-retry-success" ? 2 : 1);
    } else {
      await started;
      await delay(50);
      const reason = new DOMException("Indexing deadline exceeded", "TimeoutError");
      controller.abort(reason);
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([result, new Promise<"stalled">(resolve => { watchdog = setTimeout(() => resolve("stalled"), 700); })]);
      clearTimeout(watchdog);
      assert.notEqual(outcome, "stalled");
      assert.ok(typeof outcome === "object" && "error" in outcome);
      if (scenario.endsWith("backoff")) assert.equal(outcome.error, reason);
      assert.equal(metadataRequests, 1);
    }
    assert.equal(upserts, scenario === "ignore-success" ? 1 : 0);
    assert.equal(embeddings, scenario === "ignore-success" ? 1 : 0);
  }
} finally {
  globalThis.fetch = originalFetch;
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
