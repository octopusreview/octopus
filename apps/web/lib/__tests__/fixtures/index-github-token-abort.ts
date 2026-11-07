import { mock } from "bun:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const scenario = process.argv[2];
assert.ok(["headers", "body", "backoff", "config", "success", "legacy", "provided", "pre-aborted", "forbidden", "retry-success", "repo-helper", "file-helper"].includes(scenario));
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
let entered!: () => void;
let releaseConfig!: () => void;
const started = new Promise<void>(resolve => { entered = resolve; });
const configReleased = new Promise<void>(resolve => { releaseConfig = resolve; });
let configRequests = 0;
mock.module("server-only", () => ({}));
mock.module("@/lib/github-app-config", () => ({ getGithubAppConfig: async () => {
  configRequests++;
  if (scenario === "config") { entered(); await configReleased; }
  return { appId: "123", privateKey };
} }));
let writes = 0;
mock.module("@/lib/qdrant", () => ({ ensureCollection: async () => {}, upsertChunks: async () => { writes++; }, deleteRepoFileChunks: async () => {} }));
let tokenRequests = 0;
const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  if (path.endsWith("/access_tokens")) {
    tokenRequests++;
    if (scenario === "forbidden") { res.statusCode = 403; return res.end("{}"); }
    if (scenario === "retry-success" && tokenRequests === 1) { res.statusCode = 503; return res.end("{}"); }
    if (["headers", "repo-helper", "file-helper"].includes(scenario)) { entered(); return; }
    if (scenario === "body") { res.write('{"token":"'); entered(); return; }
    if (scenario === "backoff") { res.statusCode = 503; res.end("{}"); entered(); return; }
    return res.end('{"token":"synthetic"}');
  }
  if (path.includes("/git/trees/")) return res.end('{"tree":[]}');
  if (path.endsWith("/contributors")) return res.end("[]");
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
  if (scenario === "legacy") {
    const { getInstallationToken } = await import("@/lib/github");
    assert.equal(await getInstallationToken(1), "synthetic");
    assert.equal(tokenRequests, 1);
  } else if (scenario.endsWith("-helper")) {
    const { getRepositoryDetails, getFileContent } = await import("@/lib/github");
    const controller = new AbortController();
    const reason = new DOMException("synthetic deadline", "TimeoutError");
    const operation = scenario === "repo-helper"
      ? getRepositoryDetails(1, "fixture", "repo", undefined, controller.signal)
      : getFileContent(1, "fixture", "repo", "main", ".octopusignore", undefined, controller.signal);
    const result = operation.then(() => null, error => error);
    await started;
    controller.abort(reason);
    assert.equal(await result, reason);
    assert.equal(tokenRequests, 1);
  } else {
    const { indexRepository } = await import("@/lib/indexer");
    const controller = new AbortController();
    const reason = new DOMException("synthetic deadline", "TimeoutError");
    if (scenario === "pre-aborted") controller.abort(reason);
    const result = indexRepository({ repoId: "synthetic", indexAttemptId: "synthetic" }, "fixture/repo", "main", 1, undefined, controller.signal, "github", "synthetic", scenario === "provided" ? "synthetic" : undefined)
      .then(stats => ({ stats }), error => ({ error }));
    if (scenario === "success" || scenario === "provided" || scenario === "retry-success") {
      const outcome = await result;
      assert.ok("stats" in outcome);
      assert.equal(tokenRequests, scenario === "provided" ? 0 : scenario === "retry-success" ? 2 : 1);
    } else if (scenario === "pre-aborted" || scenario === "forbidden") {
      const outcome = await result;
      assert.ok("error" in outcome);
      if (scenario === "pre-aborted") { assert.equal(outcome.error, reason); assert.equal(configRequests, 0); assert.equal(tokenRequests, 0); }
      else { assert.match(String(outcome.error), /Failed to get installation token: 403/); assert.equal(tokenRequests, 1); }
    } else {
      await started;
      await delay(50);
      controller.abort(reason);
      if (scenario === "config") releaseConfig();
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([result, new Promise<"stalled">(resolve => { watchdog = setTimeout(() => resolve("stalled"), 700); })]);
      clearTimeout(watchdog);
      assert.notEqual(outcome, "stalled");
      assert.ok(typeof outcome === "object" && "error" in outcome);
      assert.equal(outcome.error, reason);
      assert.equal(tokenRequests, scenario === "config" ? 0 : 1);
    }
    assert.equal(writes, 0);
  }
} finally {
  globalThis.fetch = originalFetch;
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
