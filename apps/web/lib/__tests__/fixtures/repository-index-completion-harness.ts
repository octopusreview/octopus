import { mock } from "bun:test";
import "./index-github-rate-mocks";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
assert.match(url.pathname, /(^|[-_])test($|[-_])/);
const scenario = process.argv[2];
const sessionTimezone = scenario === "timezone-berlin" ? "Europe/Berlin" : "UTC";
if (scenario.startsWith("timezone-")) {
  // Apply to every pooled connection, including the helper's UPDATE connection.
  url.searchParams.set("options", `-c timezone=${sessionTimezone}`);
  process.env.DATABASE_URL = url.toString();
}
mock.module("server-only", () => ({}));
const { prisma } = await import("@octopus/db");
const { recordRepositoryIndexCompletion: recordCompletion, runRepositoryIndex } = await import("@/lib/repository-index-completion");
const recordRepositoryIndexCompletion = (id: string, time?: Date) => prisma.$transaction(tx => recordCompletion(tx, id, time));
const migration = await readFile(new URL(
  "../../../../../packages/db/prisma/migrations/20261014120000_add_repository_first_indexed_at/migration.sql",
  import.meta.url,
), "utf8");
const early = new Date("2026-01-01T12:00:00.123Z");
const late = new Date("2026-01-02T12:00:00.456Z");
const fixture = randomUUID();
const org = await prisma.organization.create({ data: { name: "Index completion test", slug: `index-test-${fixture}` } });
let indexAttemptId = randomUUID();
const repo = await prisma.repository.create({ data: {
  organizationId: org.id, name: "Index test", fullName: "fixture/index", externalId: fixture, indexStatus: "indexing", indexAttemptId,
} });
const claim = async () => {
  indexAttemptId = randomUUID();
  await prisma.repository.update({ where: { id: repo.id }, data: { indexStatus: "indexing", indexAttemptId } });
};
const snapshot = () => prisma.repository.findUniqueOrThrow({ where: { id: repo.id } });
const stats = { totalFiles: 2, indexedFiles: 1, totalChunks: 1, totalVectors: 1,
  contributors: [], contributorCount: 0, durationMs: 10 };

try {
  if (scenario.startsWith("storage-")) {
    const { exerciseStorageRace } = await import("./repository-index-storage-harness");
    await exerciseStorageRace(scenario, repo);
  } else if (scenario.startsWith("timezone-")) {
    const session = await prisma.$queryRaw<Array<{ TimeZone: string }>>`SHOW TimeZone`;
    assert.equal(session[0].TimeZone, sessionTimezone);
    const completedAt = new Date("2026-07-01T12:34:56.789Z");
    await recordRepositoryIndexCompletion(repo.id, completedAt);
    const rows = await prisma.$queryRaw<Array<{ indexedAt: string; firstIndexedAt: string; updatedAt: string }>>`
      SELECT "indexedAt"::text AS "indexedAt", "firstIndexedAt"::text AS "firstIndexedAt",
        "updatedAt"::text AS "updatedAt" FROM repositories WHERE id = ${repo.id}
    `;
    const expected = completedAt.toISOString().replace("T", " ").slice(0, -1);
    assert.deepEqual(rows, [{ indexedAt: expected, firstIndexedAt: expected, updatedAt: expected }]);
  } else if (scenario === "migration") {
    await prisma.$transaction(async tx => {
      const schema = `index_migration_${fixture.replaceAll("-", "")}`;
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$executeRawUnsafe('CREATE TABLE repositories (id TEXT PRIMARY KEY, "indexedAt" TIMESTAMP(3), name TEXT)');
      await tx.$executeRaw`INSERT INTO repositories VALUES ('old', ${early}::timestamp, 'Preserved'), ('new', NULL, 'Unindexed')`;
      const before = await tx.$queryRaw`SELECT * FROM repositories ORDER BY id`;
      await tx.$executeRawUnsafe(migration);
      assert.deepEqual(await tx.$queryRaw`SELECT id, "indexedAt", name FROM repositories ORDER BY id`, before);
      assert.deepEqual(await tx.$queryRaw`SELECT "firstIndexedAt" FROM repositories`, [{ firstIndexedAt: null }, { firstIndexedAt: null }]);
      const columns = await tx.$queryRaw<Array<{ column_default: string | null; is_nullable: string; data_type: string }>>`
        SELECT column_default, is_nullable, data_type FROM information_schema.columns
        WHERE table_schema = ${schema} AND table_name = 'repositories' AND column_name = 'firstIndexedAt'
      `;
      assert.deepEqual(columns, [{ column_default: null, is_nullable: "YES", data_type: "timestamp without time zone" }]);
      const guards = await readFile(new URL("../../../../../packages/db/prisma/migrations/20261014143000_index_completion_guards/migration.sql", import.meta.url), "utf8");
      await tx.$executeRawUnsafe(guards);
      assert.deepEqual(await tx.$queryRaw`SELECT id, "indexedAt", name FROM repositories ORDER BY id`, before);
      assert.deepEqual(await tx.$queryRaw`SELECT "indexAttemptId", "localIndexUpload" FROM repositories`, [
        { indexAttemptId: null, localIndexUpload: null }, { indexAttemptId: null, localIndexUpload: null },
      ]);
      const generationMigration = await readFile(new URL("../../../../../packages/db/prisma/migrations/20261014230000_active_index_generation/migration.sql", import.meta.url), "utf8");
      await tx.$executeRawUnsafe(generationMigration);
      assert.deepEqual(await tx.$queryRaw`SELECT id, "indexedAt", name FROM repositories ORDER BY id`, before);
      assert.deepEqual(await tx.$queryRaw`SELECT "activeIndexGeneration" FROM repositories`, [{ activeIndexGeneration: null }, { activeIndexGeneration: null }]);
      const generationColumn = await tx.$queryRaw`
        SELECT column_default, is_nullable, data_type FROM information_schema.columns
        WHERE table_schema = ${schema} AND table_name = 'repositories' AND column_name = 'activeIndexGeneration'
      `;
      assert.deepEqual(generationColumn, [{ column_default: null, is_nullable: "YES", data_type: "text" }]);
      await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    });
  } else if (scenario === "first" || scenario === "reindex" || scenario === "legacy") {
    if (scenario === "legacy") await prisma.repository.update({ where: { id: repo.id }, data: { indexedAt: early } });
    else await recordRepositoryIndexCompletion(repo.id, early);
    if (scenario !== "first") await recordRepositoryIndexCompletion(repo.id, late);
    const result = await snapshot();
    assert.deepEqual(result.firstIndexedAt, scenario === "legacy" ? null : early);
    assert.deepEqual(result.indexedAt, scenario === "first" ? early : late);
  } else if (scenario.startsWith("concurrent-")) {
    let release!: () => void;
    let acquired!: () => void;
    const ready = new Promise<void>(resolve => { acquired = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const lock = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM repositories WHERE id = ${repo.id} FOR UPDATE`;
      acquired();
      await gate;
    }, { timeout: 15_000 });
    await ready;
    const waitForBlocked = async (count: number) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()
          AND wait_event_type = 'Lock' AND query LIKE '%UPDATE "repositories"%'
        `;
        if (Number(rows[0].count) >= count) return;
        await Bun.sleep(10);
      }
      throw new Error("Completion did not wait on the repository lock");
    };
    const times = scenario === "concurrent-earlier-first" ? [early, late] : [late, early];
    const first = recordRepositoryIndexCompletion(repo.id, times[0]);
    try {
      await waitForBlocked(1);
      const second = recordRepositoryIndexCompletion(repo.id, times[1]);
      try { await waitForBlocked(2); } finally { release(); }
      await Promise.all([lock, first, second]);
    } finally { release(); await lock; }
    const result = await snapshot();
    assert.deepEqual(result.firstIndexedAt, early);
    assert.deepEqual(result.indexedAt, times[1]);
  } else if (["failed", "cancelled", "background", "late-cancel", "empty", "superseded", "background-replacement", "background-setup-failure", "background-notification-failure", "background-unconfigured"].includes(scenario)) {
    const controller = new AbortController();
    const notifications: string[] = [];
    mock.module("@/lib/indexer", () => ({ indexRepository: async () => {
      if (scenario === "background-replacement") {
        await claim();
        throw new Error("Cancelled worker failed after restart");
      }
      if (scenario === "failed") throw new Error("Index fixture failed");
      if (scenario === "cancelled") { controller.abort(); throw new Error("Indexing cancelled"); }
      if (scenario === "late-cancel") controller.abort();
      if (scenario === "superseded") await prisma.repository.update({ where: { id: repo.id }, data: { indexStatus: "pending", indexAttemptId: null } });
      return scenario === "empty" ? { ...stats, indexedFiles: 0, totalChunks: 0, totalVectors: 0 } : stats;
    } }));
    let notificationAttempts = 0;
    mock.module("@/lib/pubby", () => ({ pubby: { trigger: (_channel: string, _event: string, data: { repoId: string }) => {
      notificationAttempts++;
      if (scenario === "background-unconfigured") throw new Error("Pubby is not configured");
      if ((scenario === "background-setup-failure" && notificationAttempts === 1) || scenario === "background-notification-failure") return Promise.reject(new Error("Notification unavailable"));
      notifications.push(data.repoId);
      return Promise.resolve();
    } } }));
    mock.module("@/lib/events", () => ({ eventBus: { emit: () => {} } }));
    mock.module("@/lib/summarizer", () => ({ summarizeRepository: async () => ({ summary: "Fixture", purpose: "Fixture" }) }));
    mock.module("@/lib/indexing-abort", () => ({ clearAbortController: () => {} }));
    const { runIndexingInBackground } = await import("@/lib/indexing-runner");
    await runIndexingInBackground(repo.id, repo.fullName, "main", org.id, 0, "fixture", () => {}, controller, indexAttemptId);
    const result = await snapshot();
    const succeeds = ["background", "background-setup-failure", "background-notification-failure", "background-unconfigured"].includes(scenario);
    assert.equal(result.firstIndexedAt !== null, succeeds);
    assert.equal(result.indexedAt !== null, succeeds);
    if (succeeds) {
      assert.equal(result.indexStatus, "indexed");
      assert.equal(result.activeIndexGeneration, indexAttemptId);
    }
    if (scenario === "background-unconfigured") assert.equal(notificationAttempts, 2);
    if (scenario === "background-notification-failure") assert.equal(notificationAttempts, 2);
    if (scenario === "superseded") assert.equal(result.indexStatus, "pending");
    if (["superseded", "background-replacement"].includes(scenario)) assert.deepEqual(notifications, [repo.id]);
    if (scenario === "background-replacement") assert.equal(result.indexStatus, "indexing");
  } else if (scenario === "empty-then-content" || scenario === "failed-reindex") {
    const emptyStats = { ...stats, indexedFiles: 0, totalChunks: 0, totalVectors: 0 };
    await runRepositoryIndex(repo.id, indexAttemptId, async () => scenario === "empty-then-content" ? emptyStats : stats);
    const first = await snapshot();
    await claim();
    if (scenario === "empty-then-content") {
      assert.equal(first.firstIndexedAt, null);
      assert.equal(first.indexedAt, null);
      await runRepositoryIndex(repo.id, indexAttemptId, async () => stats);
      assert.ok((await snapshot()).firstIndexedAt);
    } else {
      await assert.rejects(() => runRepositoryIndex(repo.id, indexAttemptId, async () => { throw new Error("Read failed"); }), /Read failed/);
      assert.deepEqual((await snapshot()).firstIndexedAt, first.firstIndexedAt);
      assert.deepEqual((await snapshot()).indexedAt, first.indexedAt);
    }
  } else if (scenario === "replacement") {
    let finish!: () => void;
    let began!: () => void;
    const ready = new Promise<void>(resolve => { began = resolve; });
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const old = runRepositoryIndex(repo.id, indexAttemptId, async () => { began(); await pending; return stats; });
    const observed = old.then(() => null, error => error);
    await ready;
    await claim();
    await runRepositoryIndex(repo.id, indexAttemptId, async () => ({ ...stats, indexedFiles: 2 }));
    const completed = await snapshot();
    finish();
    assert.match(String(await observed), /no longer current/);
    const after = await snapshot();
    assert.deepEqual(after.firstIndexedAt, completed.firstIndexedAt);
    assert.equal(after.indexStatus, "indexed");
    assert.equal(after.indexedFiles, 2);
  } else if (scenario === "actions" || scenario === "community") {
    await prisma.repository.update({ where: { id: repo.id }, data: { indexStatus: "pending" } });
    let calls = 0;
    mock.module("@/lib/indexer", () => ({ indexRepository: async (...args: unknown[]) => {
      calls++;
      assert.deepEqual(args[0], { repoId: repo.id, indexAttemptId: (await snapshot()).indexAttemptId });
      assert.equal(args[3], 0);
      assert.equal(args[8], "fixture-token");
      assert.ok((await snapshot()).indexAttemptId);
      return stats;
    } }));
    mock.module("@/lib/api-auth", () => ({ authenticateApiToken: async () => ({ org }) }));
    mock.module("@/lib/cost", () => ({ isOrgOverSpendLimit: async () => false }));
    mock.module("@/lib/review-core", () => ({ generateLocalReview: async () => ({ findings: [], summary: "Fixture", model: "fixture" }) }));
    mock.module("@/lib/summarizer", () => ({ summarizeRepository: async () => ({ summary: "Fixture", purpose: "Fixture" }) }));
    mock.module("@/lib/analyzer", () => ({ analyzeRepository: async () => "Fixture" }));
    mock.module("@/lib/github", () => ({ getRepositoryTree: async () => [], getPullRequestDiff: async () => "" }));
    mock.module("@/lib/events/bus", () => ({ eventBus: { emit: () => {} } }));
    mock.module("@/lib/queue", () => ({ enqueue: async () => "fixture" }));
    mock.module("@/lib/community-pr-persist", () => ({ CommunityRepositoryChangedError: class extends Error {}, persistCommunityReviewToPR: async () => {} }));
    mock.module("@/lib/crypto", () => ({ encryptString: (text: string) => text, decryptString: (text: string) => text }));
    mock.module("@/lib/oss-bot", () => ({ getBotToken: () => "fixture-token" }));
    mock.module("@/lib/oss-review-post", () => ({ postOssReview: async () => ({ posted: 0, skipped: 0 }) }));
    const diff = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n";
    if (scenario === "actions") {
      globalThis.fetch = (async () => Response.json({ id: fixture, default_branch: "main", private: false, full_name: repo.fullName })) as typeof fetch;
      const { POST } = await import("@/app/api/github-action/review/route");
      const response = await POST(new Request("https://fixture.invalid/api/github-action/review", {
        method: "POST", headers: { "x-octopus-action-secret": process.env.OCTOPUS_ACTION_SECRET ?? "" },
        body: JSON.stringify({ owner: "fixture", repo: "index", githubToken: "fixture-token", diff }),
      }) as never);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).indexed, true);
    } else {
      const job = await prisma.communityReviewJob.create({ data: {
        status: "pending", repoFullName: repo.fullName, repositoryId: repo.id, organizationId: org.id,
        diff, githubToken: "fixture-token", expiresAt: new Date(Date.now() + 60_000),
      } });
      const { processCommunityReview } = await import("@/lib/community-review");
      await processCommunityReview(job.id);
      assert.equal((await prisma.communityReviewJob.findUniqueOrThrow({ where: { id: job.id } })).status, "completed");
    }
    assert.equal(calls, 1);
    const completed = await snapshot();
    assert.equal(completed.indexStatus, "indexed");
    assert.equal(completed.totalVectors, 1);
    assert.ok(completed.firstIndexedAt);
    assert.deepEqual(completed.indexedAt, completed.firstIndexedAt);
  } else if (scenario === "empty-incremental-full" || scenario === "legacy-incremental") {
    let writes = 0;
    let full = false;
    mock.module("@/lib/qdrant", () => ({
      ensureCollection: async () => {}, deleteRepoFileChunks: async () => {},
      upsertChunks: async () => { writes++; },
    }));
    mock.module("@/lib/embeddings", () => ({ createEmbeddings: async (texts: string[]) => texts.map(() => [0.1]) }));
    mock.module("@/lib/github", () => ({
      getInstallationToken: async () => "fixture-token", getRepositoryDetails: async () => ({ default_branch: "main" }),
      getFileContent: async (_id: number, _owner: string, _name: string, _ref: string, path: string) => path === ".octopusignore" ? null : "export const a = 1;",
      addCommentReaction: async () => {}, getPullRequestDetails: async () => null, createCheckRun: async () => 1, updateCheckRun: async () => {},
    }));
    mock.module("next/server", () => ({ after: () => {}, NextRequest: Request, NextResponse: { json: Response.json } }));
    mock.module("next/cache", () => ({ revalidatePath: () => {} }));
    mock.module("@/lib/github-app-config", () => ({ getGithubAppConfig: async () => ({ webhookSecret: "fixture-secret" }) }));
    mock.module("@/lib/webhook-shared", () => ({ startReviewFlow: async () => {} }));
    mock.module("@/lib/repo-sync", () => ({ syncOrgRepos: async () => {}, applyRepositoryEvent: async () => {} }));
    mock.module("@/lib/webhook-tenant", () => ({
      resolveGithubWebhookTenant: async () => ({ status: "resolved", organizationId: org.id, repositoryId: repo.id }),
      observeGithubWebhookDeliveryBestEffort: async () => {},
    }));
    globalThis.fetch = (async (input: string | URL | Request) => {
      const path = String(input);
      if (path.includes("/pulls/")) return Response.json([{ filename: "a.ts", status: "added" }]);
      if (path.includes("/git/trees/")) return Response.json({ tree: full ? [{ type: "blob", path: "a.ts", sha: "fixture" }] : [] });
      if (path.includes("/git/blobs/")) return Response.json({ encoding: "base64", content: Buffer.from("export const a = 1;").toString("base64") });
      if (path.includes("/contributors")) return Response.json([]);
      throw new Error(`Unexpected fixture request: ${path}`);
    }) as typeof fetch;
    const { indexRepository } = await import("@/lib/indexer");
    const index = () => indexRepository({ repoId: repo.id, indexAttemptId }, repo.fullName, "main", 1);
    await runRepositoryIndex(repo.id, indexAttemptId, index);
    if (scenario === "legacy-incremental") await prisma.repository.update({ where: { id: repo.id }, data: { indexedAt: early } });
    const { POST } = await import("@/app/api/github/webhook/route");
    const body = JSON.stringify({ action: "closed", installation: { id: 1 }, repository: { id: fixture }, pull_request: { number: 1, merged: true } });
    const response = await POST(new Request("https://fixture.invalid/api/github/webhook", { method: "POST", body, headers: {
      "x-github-event": "pull_request", "x-hub-signature-256": "sha256=" + createHmac("sha256", "fixture-secret").update(body).digest("hex"),
    } }) as never);
    assert.equal(response.status, 200);
    assert.equal(writes, 1, "The webhook must execute incremental embedding and storage");
    const incremental = await snapshot();
    assert.equal(incremental.firstIndexedAt, null);
    if (scenario === "empty-incremental-full") assert.equal(incremental.indexedAt, null);
    else assert.ok(incremental.indexedAt && incremental.indexedAt > early);
    full = true;
    await claim();
    await runRepositoryIndex(repo.id, indexAttemptId, index);
    const completed = await snapshot();
    assert.equal(completed.indexStatus, "indexed");
    assert.equal(completed.firstIndexedAt !== null, scenario === "empty-incremental-full");
    assert.ok(completed.indexedAt);
  } else if (scenario.startsWith("local")) {
    mock.module("@/lib/qdrant", () => ({ upsertChunks: async () => {} }));
    mock.module("@/lib/embeddings", () => ({ createEmbeddings: async (texts: string[]) => texts.map(() => [0.1]) }));
    const { prepareRepoForLocalIndex, claimLocalIndexBatch, recordLocalIndexProgress, indexLocalBatch, markLocalIndexFailed } = await import("@/lib/index-local");
    const single = scenario === "local-single";
    const prepared = await prepareRepoForLocalIndex(org.id, "github", `local/${fixture}`, "main", { totalBatches: single ? 1 : 2, totalFiles: 2 });
    assert.ok(prepared.ok);
    const id = prepared.repoId;
    const files = [{ path: "a.ts", content: "export const a = 1;" }, { path: "b.ts", content: "export const b = 2;" }];
    const firstFiles = single ? files : files.slice(0, 1);
    const first = await claimLocalIndexBatch(id, org.id, 0, single ? 1 : 2, firstFiles, prepared.uploadId);
    const delta = await indexLocalBatch(id, `local/${fixture}`, org.id, firstFiles, first);
    const progress = { indexedFiles: delta.indexedInBatch, totalChunks: delta.chunksInBatch, totalVectors: delta.chunksInBatch };
    await recordLocalIndexProgress(id, Date.now(), progress, single, first);
    if (scenario === "local-gap") {
      await assert.rejects(() => claimLocalIndexBatch(id, org.id, 2, 3, files.slice(1), first.upload.id), /out of order/);
    } else if (scenario === "local-duplicate") {
      await assert.rejects(() => claimLocalIndexBatch(id, org.id, 1, 2, firstFiles, first.upload.id), /duplicate/);
    } else if (scenario === "local-count-under" || scenario === "local-count-over") {
      const finalFiles = scenario === "local-count-under" ? [] : [...files.slice(1), { path: "c.ts", content: "export const c = 3;" }];
      await assert.rejects(() => claimLocalIndexBatch(id, org.id, 1, 2, finalFiles, first.upload.id), /declared file count/);
    } else if (scenario === "local-wrong-session") {
      await assert.rejects(() => claimLocalIndexBatch(id, org.id, 1, 2, files.slice(1), "old-upload"), /no longer current/);
    } else if (!single && scenario !== "local-nonfinal") {
      const final = await claimLocalIndexBatch(id, org.id, 1, 2, files.slice(1), scenario === "local-legacy" ? undefined : first.upload.id);
      if (scenario === "local-cancel") {
        await prisma.repository.update({ where: { id }, data: { indexStatus: "pending", indexAttemptId: null } });
        await assert.rejects(() => recordLocalIndexProgress(id, null, progress, true, final), /cancelled or replaced/);
        await markLocalIndexFailed(id, final);
      } else await recordLocalIndexProgress(id, null, progress, true, final);
    }
    const result = await prisma.repository.findUniqueOrThrow({ where: { id } });
    const verified = ["local-single", "local-verified"].includes(scenario);
    assert.equal(result.activeIndexGeneration, verified || scenario === "local-legacy" ? prepared.uploadId : null);
    assert.equal(result.firstIndexedAt !== null, verified);
    if (scenario === "local-legacy") assert.ok(result.indexedAt);
    if (scenario === "local-cancel") assert.equal(result.indexStatus, "pending");
  } else throw new Error(`Unknown scenario ${scenario}`);
} finally {
  await prisma.communityReviewJob.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.$disconnect();
}
