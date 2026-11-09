import { mock } from "bun:test";
import assert from "node:assert/strict";

const db = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["postgres:", "postgresql:"].includes(db.protocol));
assert.ok(["localhost", "127.0.0.1"].includes(db.hostname));
assert.match(db.pathname.slice(1), /(^|[-_])test($|[-_])/);
assert.equal(db.search + db.hash, "");
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
const { recordIndexRateLimit } = await import("../../github-index-rate-state");
const scope = "github-index-installation:123";
const blobs = Array.from({ length: 12 }, (_, i) => ({ path: `file${i}.ts`, type: "blob", sha: String(i), size: 16 }));
let limited = true;
let requests = 0;
const blobIds = new Set<string>();
globalThis.fetch = (async (input: string | URL | Request) => {
  requests++;
  const url = String(input);
  assert.ok(url.startsWith("https://api.github.com/"));
  if (url.includes("/git/trees/")) return Response.json({ tree: blobs });
  if (url.includes("/contributors?")) return Response.json([]);
  const match = url.match(/\/git\/blobs\/(\d+)$/);
  assert.ok(match);
  blobIds.add(match[1]);
  if (limited) return new Response(null, { status: 403, headers: {
    date: new Date().toUTCString(), "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
  } });
  return Response.json({ encoding: "base64", content: Buffer.from("export const x = 1;").toString("base64") });
}) as typeof fetch;
const run = () => indexRepository({ repoId: "synthetic", indexAttemptId: "synthetic" }, "synthetic/repo", "main", 123);
try {
  await prisma.$executeRaw`DELETE FROM "github_index_rate_windows"`;
  await assert.rejects(run(), GitHubIndexDeferredError);
  assert.ok(blobIds.size > 0 && blobIds.size <= 10, "only already-admitted requests may complete the first batch");
  assert.equal(vectorWrites, 0, "a partial index is never published");
  const before = requests;
  await assert.rejects(run(), GitHubIndexDeferredError);
  assert.equal(requests, before, "another worker does not contact GitHub during the cooldown");
  await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${scope}`;
  limited = false;
  const result = await run();
  assert.equal(result.indexedFiles, 12);
  assert.equal(vectorWrites, 1);

  for (let i = 0; i < 7; i++) {
    await recordIndexRateLimit(scope, null);
    if (i < 6) await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${scope}`;
  }
  const manual = () => indexRepository({ repoId: "synthetic", indexAttemptId: "manual" }, "synthetic/repo", "main", 123, undefined, undefined, "github", undefined, undefined, true);
  const beforeManual = requests;
  await assert.rejects(manual(), (error: unknown) => error instanceof GitHubIndexDeferredError && error.paused);
  assert.equal(requests, beforeManual, "manual retry cannot bypass an active cooldown");
  await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${scope}`;
  await assert.rejects(run(), (error: unknown) => error instanceof GitHubIndexDeferredError && error.paused);
  assert.equal(requests, beforeManual, "automatic work stops after the probe limit");
  assert.equal((await manual()).indexedFiles, 12, "one authorized manual probe can restore indexing");
} finally {
  await prisma.$executeRaw`DELETE FROM "github_index_rate_windows"`;
  await prisma.$disconnect();
}
