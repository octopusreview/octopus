import { assertDisposableIndexDatabase } from "./disposable-index-db";
import { mock } from "bun:test";
import assert from "node:assert/strict";

assertDisposableIndexDatabase();
const scenario = process.argv[2];
assert.ok(["unmarked-403", "explicit-403", "explicit-429"].includes(scenario));
mock.module("server-only", () => ({}));
mock.module("@/lib/github", () => ({ getInstallationToken: async () => "synthetic-token", getRepositoryDetails: async () => null, getFileContent: async () => null }));
mock.module("@/lib/bitbucket", () => ({}));
mock.module("@/lib/gitlab", () => ({}));
let vectorWrites = 0;
mock.module("@/lib/qdrant", () => ({ ensureCollection: async () => {}, upsertChunks: async () => { vectorWrites++; }, deleteRepoFileChunks: async () => {} }));
mock.module("@/lib/embeddings", () => ({ createEmbeddings: async (texts: string[]) => texts.map(() => [0.1]) }));
const { prisma } = await import("@octopus/db");
const { indexRepository } = await import("../../indexer");
const { GitHubIndexDeferredError } = await import("../../github-index-fetch");
const scopes = ["github-index-installation:123", "github-index-installation:456"];
const blobs = Array.from({ length: 12 }, (_, i) => ({ path: `file${i}.ts`, type: "blob", sha: String(i), size: 16 }));
const requests: string[] = [];
const blobCalls = new Map<string, number>();
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  assert.ok(url.startsWith("https://api.github.com/repos/synthetic/"));
  requests.push(url);
  if (url.includes("/git/trees/")) return Response.json({ tree: blobs });
  if (url.includes("/contributors?")) return Response.json([]);
  const match = url.match(/\/repos\/synthetic\/(repo[0-2]|other)\/git\/blobs\/(\d+)$/);
  assert.ok(match, "unexpected synthetic request");
  const [, repo, blob] = match;
  const key = `${repo}:${blob}`;
  blobCalls.set(key, (blobCalls.get(key) ?? 0) + 1);
  if (repo === "other") return Response.json({ encoding: "base64", content: Buffer.from("export const synthetic = 1;").toString("base64") });
  if (scenario === "unmarked-403") return new Response(null, { status: 403 });
  return new Response(null, { status: scenario === "explicit-403" ? 403 : 429, headers: { "retry-after": "5" } });
}) as typeof fetch;
const run = (repo: string, installation: number) => indexRepository({ repoId: `synthetic-${repo}`, indexAttemptId: `attempt-${repo}` }, `synthetic/${repo}`, "main", installation);
try {
  await prisma.$executeRaw`DELETE FROM "github_index_rate_windows" WHERE "scope" IN (${scopes[0]}, ${scopes[1]})`;
  const results = await Promise.allSettled([run("repo0", 123), run("repo1", 123), run("repo2", 123)]);
  assert.equal(results.filter(result => result.status === "rejected").length, 3);
  assert.equal(vectorWrites, 0, "denied partial indexes must never be published");
  if (scenario === "unmarked-403") {
    for (const repo of ["repo0", "repo1", "repo2"]) {
      for (let i = 0; i < 10; i++) assert.equal(blobCalls.get(`${repo}:${i}`), 2, "each denied blob gets one bounded retry");
      assert.equal(blobCalls.has(`${repo}:10`), false, "a denial prevents the next batch");
      assert.equal(blobCalls.has(`${repo}:11`), false);
    }
    assert.equal([...blobCalls.values()].reduce((sum, n) => sum + n, 0), 60);
    const windows = await prisma.$queryRaw<unknown[]>`SELECT 1 FROM "github_index_rate_windows" WHERE "scope" = ${scopes[0]}`;
    assert.equal(windows.length, 0, "unmarked 403s must not be asserted to be a shared rate limit");
  } else {
    assert.ok(results.every(result => result.status === "rejected" && result.reason instanceof GitHubIndexDeferredError));
    assert.ok([...blobCalls.values()].reduce((sum, n) => sum + n, 0) <= 30, "only the already-admitted first batches may reach GitHub");
    const before = requests.length;
    await assert.rejects(run("repo0", 123), GitHubIndexDeferredError);
    assert.equal(requests.length, before, "the installation cooldown blocks subsequent attempts");
  }
  const other = await run("other", 456);
  assert.equal(other.indexedFiles, 12, "an unrelated installation remains available");
  assert.equal(vectorWrites, 1);
  console.log(`PASS three synthetic indexes: ${scenario}`);
} finally {
  await prisma.$executeRaw`DELETE FROM "github_index_rate_windows" WHERE "scope" IN (${scopes[0]}, ${scopes[1]})`;
  await prisma.$disconnect();
}
