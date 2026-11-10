import { assertDisposableIndexDatabase } from "./disposable-index-db";
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

assertDisposableIndexDatabase();
mock.module("server-only", () => ({}));
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
mock.module("@/lib/github-app-config", () => ({ getGithubAppConfig: async () => ({ appId: "123", privateKey }) }));
mock.module("@/lib/qdrant", () => ({ ensureCollection: async () => {}, upsertChunks: async () => {}, deleteRepoFileChunks: async () => {} }));
const { prisma } = await import("@octopus/db");
const { indexRepository } = await import("../../indexer");
const { GitHubIndexDeferredError, githubIndexFetch } = await import("../../github-index-fetch");
const { getInstallationToken } = await import("../../github");
let tokenCalls = 0, otherCalls = 0, limited = true;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  assert.equal(url.hostname, "api.github.com");
  if (url.pathname.endsWith("/access_tokens")) {
    tokenCalls++;
    if (limited) return new Response(null, { status: 403, headers: { date: new Date().toUTCString(), "retry-after": "3600" } });
    return Response.json({ token: "synthetic-token" });
  }
  otherCalls++;
  return Response.json({ tree: [] });
}) as typeof fetch;
try {
  await prisma.$executeRaw`DELETE FROM "github_index_rate_windows"`;
  const index = (installationId: number, manual = false) => indexRepository({ repoId: "synthetic", indexAttemptId: "synthetic" },
    "fixture/repo", "main", installationId, undefined, undefined, "github", undefined, undefined, manual);
  await assert.rejects(index(123), GitHubIndexDeferredError);
  await assert.rejects(index(456), GitHubIndexDeferredError);
  await assert.rejects(index(456, true), GitHubIndexDeferredError);
  assert.equal(tokenCalls, 1, "workers from different installations share the app cooldown");
  assert.equal(otherCalls, 0, "no repository or quota request is made during the cooldown");
  await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = 'github-index-app'`;
  limited = false;
  assert.equal(await getInstallationToken(456, undefined, (url, init) => githubIndexFetch("github-index-app", url, init)), "synthetic-token");
  assert.equal(tokenCalls, 2, "a single probe can reopen the app scope after the cooldown");
} finally {
  await prisma.$executeRaw`DELETE FROM "github_index_rate_windows"`;
  await prisma.$disconnect();
}
