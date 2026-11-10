import { assertDisposableIndexDatabase } from "./disposable-index-db";
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";

assertDisposableIndexDatabase();
const qdrantUrl = new URL(process.env.QDRANT_URL ?? "http://invalid");
assert.equal(qdrantUrl.protocol, "http:");
assert.equal(qdrantUrl.hostname, "127.0.0.1");
assert.match(qdrantUrl.port, /^\d+$/);
assert.equal(qdrantUrl.pathname, "/");
assert.equal(qdrantUrl.search + qdrantUrl.hash + qdrantUrl.username + qdrantUrl.password, "");
assert.equal(process.env.OCTOPUS_EMBED_DIM, "4");
const qdrantContainer = process.env.OCTOPUS_QDRANT_TEST_CONTAINER ?? "";
assert.match(qdrantContainer, /^octopus-qdrant-e2e-[0-9a-f]{20}$/);
const portCheck = Bun.spawnSync(["docker", "port", qdrantContainer, "6333/tcp"]);
assert.equal(portCheck.exitCode, 0);
assert.equal(portCheck.stdout.toString().trim(), `127.0.0.1:${qdrantUrl.port}`);
const labelCheck = Bun.spawnSync(["docker", "inspect", "--format", '{{index .Config.Labels "octopus.synthetic-index-test"}}', qdrantContainer]);
assert.equal(labelCheck.exitCode, 0);
assert.equal(labelCheck.stdout.toString().trim(), "true");
const status = Number(process.argv[2]);
assert.ok(status === 403 || status === 429);
mock.module("server-only", () => ({}));
mock.module("@/lib/queue", () => ({ enqueue: async () => null }));
mock.module("@/lib/elasticsearch", () => ({ deleteSyncLogs: async () => {}, writeSyncLog: () => {} }));
mock.module("@/lib/repository-index-notifications", () => ({ notifyRepositoryIndex: async () => {} }));
mock.module("../../background-failure", () => ({ reportBackgroundFailure: () => {} }));
for (const [path, names] of Object.entries({
  "forgejo-connector": ["cleanupForgejoConnectorRequests"], "emails/welcome": ["sendWelcomeEmail"],
  "large-review-result": ["handleLargeReviewResult"], "community-review": ["processCommunityReview"],
  audit: ["enforceAuditLogRetention", "enforceActivityEventRetention"], "webhook-tenant": ["enforceWebhookDeliveryRetention"],
  releases: ["refreshReleaseCache"], subscription: ["renewDueSubscriptions"], credits: ["reconcileAutoReloadAttempts"],
  "marketing-outbox": ["syncMarketingConversions"], "ollama-admin": ["runOllamaPull"],
  "discover-repositories": ["discoverRepositories"], "reap-stuck-reviews": ["reapStuckReviews"], reviewer: ["processReview"],
})) mock.module(`../../${path}`, () => Object.fromEntries(names.map(name => [name, () => { throw new Error("Unexpected unrelated job"); }])));
mock.module("@/lib/github", () => ({ getInstallationToken: async () => "synthetic-token", getRepositoryDetails: async () => null, getFileContent: async () => null }));
mock.module("@/lib/bitbucket", () => ({}));
mock.module("@/lib/gitlab", () => ({}));
mock.module("@/lib/forgejo", () => ({}));
let embeddings = 0;
mock.module("@/lib/embeddings", () => ({ createEmbeddings: async (texts: string[]) => { embeddings += texts.length; return texts.map(() => [1, 0, 0, 0]); } }));
const blobs = Array.from({ length: 12 }, (_, i) => ({ path: `file${i}.ts`, type: "blob", sha: String(i), size: 16 }));
let blocked = true;
let requests = 0;
const nativeFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (new URL(url).origin === qdrantUrl.origin) return nativeFetch(input, init);
  requests++;
  assert.ok(url.startsWith("https://api.github.com/repos/synthetic/repo/"));
  if (url.includes("/git/trees/")) return Response.json({ tree: blobs });
  if (url.includes("/contributors?")) return Response.json([]);
  assert.match(url, /\/git\/blobs\/\d+$/);
  if (blocked) return new Response(null, { status, headers: { "retry-after": "5" } });
  return Response.json({ encoding: "base64", content: Buffer.from("export const synthetic = 1;").toString("base64") });
}) as typeof fetch;
const { prisma } = await import("@octopus/db");
const { getQdrantClient, getRepoChunks, searchSimilarChunks, COLLECTION_NAME } = await import("../../qdrant");
const { repositoryCodeFilter } = await import("../../repository-index-storage");
const { dispatchDeferredIndexes } = await import("../../github-deferred-index");
const { registerWorkers } = await import("../../queue-workers");
const suffix = randomUUID();
const org = await prisma.organization.create({ data: { name: "Synthetic", slug: `synthetic-${suffix}`, githubInstallationId: 123 } });
const repo = await prisma.repository.create({ data: { name: "Synthetic", fullName: "synthetic/repo", externalId: suffix,
  provider: "github", installationId: 123, organizationId: org.id, defaultBranch: "main", indexStatus: "pending" } });
const boss = new PgBoss(process.env.DATABASE_URL!);
const scope = "github-index-installation:123";
const observed: Array<{ id: string; retryCount: number }> = [];
await boss.start();
await boss.createQueue("index-repository", { retryLimit: 2, retryDelay: 0 });
async function waitForJob(id: string) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const job = await boss.getJobById("index-repository", id);
    if (job?.state === "completed" || job?.state === "failed") return job.state;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Synthetic queue job did not settle");
}
try {
  await prisma.$executeRaw`DELETE FROM "github_index_rate_windows" WHERE "scope" = ${scope}`;
  await registerWorkers({ work: async (name: string, ...args: unknown[]) => {
    if (name !== "index-repository") return "synthetic-unrelated-worker";
    const options = args[0] as { localConcurrency: number; includeMetadata: boolean };
    const callback = args[1] as (jobs: Array<{ id: string; retryCount: number }>) => Promise<void>;
    return boss.work(name, { ...options, pollingIntervalSeconds: 0.5 }, async jobs => {
      observed.push(...jobs.map(job => ({ id: job.id, retryCount: job.retryCount })));
      try { await callback(jobs); }
      catch (error) {
        const message = error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted]") : "non-error";
        console.error("SYNTHETIC_CALLBACK_FAILURE", error instanceof Error ? error.name : "unknown", message);
        throw error;
      }
    });
  } } as never, { reviewConcurrency: 1 } as never);
  const firstJob = await boss.send("index-repository", { repositoryId: repo.id, organizationId: org.id });
  assert.ok(firstJob);
  assert.equal(await waitForJob(firstJob), "completed");
  const failed = await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } });
  assert.equal(failed.indexStatus, "failed");
  assert.equal(failed.activeIndexGeneration, null);
  assert.equal(embeddings, 0);
  const qdrant = getQdrantClient();
  const collections = await qdrant.getCollections();
  if (collections.collections.some(item => item.name === COLLECTION_NAME)) {
    const before = await qdrant.count(COLLECTION_NAME, { exact: true, filter: { must: [{ key: "logicalRepoId", match: { value: repo.id } }] } });
    assert.equal(before.count, 0, "a rate-limited partial index must not be written");
  }
  const deferred = await prisma.$queryRaw<Array<{ jobId: string; indexAttemptId: string }>>`
    SELECT "jobId", "indexAttemptId" FROM "github_deferred_indexes" WHERE "repositoryId" = ${repo.id}`;
  assert.equal(deferred.length, 1);
  assert.equal(deferred[0].indexAttemptId, failed.indexAttemptId);
  const before = requests;
  assert.equal(await dispatchDeferredIndexes(boss), 0);
  assert.equal(requests, before, "no recovery request starts during the cooldown");
  await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${scope}`;
  blocked = false;
  assert.equal(await dispatchDeferredIndexes(boss), 1);
  assert.equal(await dispatchDeferredIndexes(boss), 0, "the durable retry is dispatched once");
  assert.equal(await waitForJob(deferred[0].jobId), "completed");
  const completed = await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } });
  assert.equal(completed.indexStatus, "indexed");
  assert.ok(completed.activeIndexGeneration);
  assert.notEqual(completed.activeIndexGeneration, failed.indexAttemptId);
  assert.equal(completed.totalFiles, 12);
  assert.equal(completed.indexedFiles, 12);
  assert.equal(completed.totalVectors, 12);
  assert.equal(embeddings, 12);
  const stored = await qdrant.scroll(COLLECTION_NAME, { filter: repositoryCodeFilter(repo.id, completed.activeIndexGeneration), limit: 100, with_payload: true });
  assert.equal(stored.points.length, 12);
  assert.ok(stored.points.every(point => point.payload?.indexGeneration === completed.activeIndexGeneration));
  const chunks = await getRepoChunks(repo.id, 50);
  assert.equal(chunks.length, 12);
  assert.ok(chunks.every(chunk => chunk.includes("synthetic")));
  const matches = await searchSimilarChunks(repo.id, [1, 0, 0, 0], 20);
  assert.equal(matches.length, 12);
  assert.equal(new Set(matches.map(point => point.filePath)).size, 12);
  assert.deepEqual(observed, [{ id: firstJob, retryCount: 0 }, { id: deferred[0].jobId, retryCount: 0 }]);
  assert.equal((await prisma.$queryRaw<unknown[]>`SELECT 1 FROM "github_deferred_indexes" WHERE "repositoryId" = ${repo.id}`).length, 0);
  console.log(`PASS synthetic queue-to-index recovery for HTTP ${status}`);
} finally {
  await boss.stop();
  await prisma.repository.deleteMany({ where: { id: repo.id } });
  await prisma.organization.deleteMany({ where: { id: org.id } });
  await prisma.$executeRaw`DELETE FROM "github_index_rate_windows" WHERE "scope" = ${scope}`;
  await prisma.$disconnect();
}
