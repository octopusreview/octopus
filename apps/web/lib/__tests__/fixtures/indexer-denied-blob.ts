import { mock } from "bun:test";
import assert from "node:assert/strict";
import "./index-github-rate-mocks";

const scenario = process.argv[2];
assert.ok(["denied-403", "denied-429", "mixed-denial", "recovered", "normal", "other-error", "retry-server-error", "completion-denied", "abort", "slow-sibling", "primary-reset"].includes(scenario));
mock.module("server-only", () => ({}));
const resetAt = (Math.floor(Date.now() / 1000) + 3600) * 1000;
const retryTimes: number[] = [];
let indexStatus = "indexing";
mock.module("@octopus/db", () => ({ prisma: { repository: {
  findUniqueOrThrow: async () => ({ indexStatus, indexAttemptId: "synthetic" }),
  updateMany: async ({ data }: { data: { indexStatus: string } }) => { indexStatus = data.indexStatus; return { count: 1 }; },
} } }));
mock.module("@/lib/github", () => ({ getInstallationToken: async () => "synthetic", getRepositoryDetails: async () => null, getFileContent: async () => null }));
mock.module("@/lib/bitbucket", () => ({}));
mock.module("@/lib/gitlab", () => ({}));
let vectorWrites = 0;
mock.module("@/lib/qdrant", () => ({ ensureCollection: async () => {}, upsertChunks: async () => { vectorWrites++; }, deleteRepoFileChunks: async () => {} }));
mock.module("@/lib/embeddings", () => ({ createEmbeddings: async (texts: string[]) => texts.map(() => [0.1]) }));
const blobs = Array.from({ length: scenario === "primary-reset" ? 1 : 12 }, (_, i) => ({ path: `file${i}.ts`, type: "blob", sha: String(i), size: 16 }));
const blobCalls = new Map<string, number>();
let upstreamRecovered = false;
const logs: string[] = [];
let releaseSibling!: () => void;
const siblingGate = new Promise<void>(resolve => { releaseSibling = resolve; });
let deniedRetryDone!: () => void;
const deniedRetry = new Promise<void>(resolve => { deniedRetryDone = resolve; });
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url.includes("/git/trees/")) return Response.json({ tree: blobs });
  if (url.includes("/contributors?")) return Response.json([]);
  const match = url.match(/\/git\/blobs\/(\d+)$/);
  assert.ok(match, "unexpected request");
  const id = match[1];
  const n = (blobCalls.get(id) ?? 0) + 1;
  blobCalls.set(id, n);
  if (scenario === "primary-reset") {
    if (n === 1) return Response.json({}, { status: 403, headers: {
      "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetAt / 1000),
    } });
    retryTimes.push(Date.now());
    return Response.json({ encoding: "base64", content: Buffer.from("export const x = 1;").toString("base64") });
  }
  if (scenario === "slow-sibling" && id === "1") await siblingGate;
  if (scenario === "slow-sibling" && id === "0" && n === 1) deniedRetryDone();
  if (scenario === "abort" && id === "0" && n === 1) controller.abort(reason);
  const limited = scenario === "denied-403" || scenario === "denied-429" || scenario === "completion-denied" || scenario === "abort" || scenario === "recovered" || ((scenario === "mixed-denial" || scenario === "slow-sibling") && id === "0");
  if (scenario === "other-error" || (scenario === "retry-server-error" && n > 1)) return Response.json({}, { status: 500 });
  if (scenario === "retry-server-error") return Response.json({}, { status: 403, headers: { "retry-after": "0" } });
  if (limited && (scenario !== "recovered" || !upstreamRecovered)) return Response.json({}, { status: scenario === "denied-429" ? 429 : 403, headers: { "retry-after": scenario === "abort" ? "10" : "0" } });
  return Response.json({ encoding: "base64", content: Buffer.from("export const x = 1;").toString("base64") });
}) as typeof fetch;
const { indexRepository } = await import("@/lib/indexer");
const controller = new AbortController();
const reason = new DOMException("synthetic deadline", "TimeoutError");
const index = () => indexRepository({ repoId: "synthetic", indexAttemptId: "synthetic" }, "synthetic/repo", "main", 1, message => {
  logs.push(message);
  if (scenario === "abort" && message.startsWith("GitHub returned HTTP")) controller.abort(reason);
}, controller.signal);
const run = async () => scenario === "completion-denied"
  ? (await import("@/lib/repository-index-completion")).runRepositoryIndex("synthetic", "synthetic", index)
  : index();
if (scenario === "primary-reset") {
  let failed = false;
  try { await run(); } catch { failed = true; }
  assert.ok(blobCalls.size > 0, "the synthetic initial response was exercised");
  assert.ok(retryTimes.every(time => time >= resetAt), "a known exhausted primary limit must not retry before reset");
  if (!retryTimes.length) assert.equal(failed, true, "deferred work cannot claim index success");
} else if (scenario === "denied-403" || scenario === "denied-429" || scenario === "mixed-denial" || scenario === "completion-denied" || scenario === "retry-server-error") {
  await assert.rejects(run, (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.equal((err as Error & { status?: number }).status, scenario === "denied-429" ? 429 : 403);
    return true;
  });
  assert.equal(blobCalls.has("10"), false, "no later batch after repeated denial");
  assert.equal(blobCalls.has("11"), false);
  assert.equal(vectorWrites, 0);
  if (scenario === "completion-denied") assert.equal(indexStatus, "failed");
} else if (scenario === "slow-sibling") {
  let settled = false;
  const outcome = run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  let guard!: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([deniedRetry, new Promise((_, reject) => { guard = setTimeout(() => reject(new Error("denied retry did not happen")), 2000); })]);
  } finally { clearTimeout(guard); }
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(settled, false, "the running sibling must finish before the attempt settles");
  releaseSibling();
  const error = await outcome;
  assert.ok(error instanceof Error);
  assert.equal((error as Error & { status?: number }).status, 403);
  assert.equal(settled, true);
  assert.equal(blobCalls.has("10"), false);
  assert.equal(vectorWrites, 0);
} else if (scenario === "abort") {
  await assert.rejects(run, error => error === reason);
  assert.equal(vectorWrites, 0);
} else if (scenario === "other-error") {
  await assert.rejects(run, /Indexing incomplete/);
  assert.equal(blobCalls.size, 12);
  assert.equal(vectorWrites, 0);
} else {
  if (scenario === "recovered") {
    await assert.rejects(run);
    upstreamRecovered = true;
  }
  const result = await run();
  assert.equal(result.indexedFiles, 12);
  assert.equal(blobCalls.size, 12);
  assert.equal(vectorWrites, 1);
  if (scenario === "recovered") assert.ok([...blobCalls.values()].every(n => n <= 2));
}
