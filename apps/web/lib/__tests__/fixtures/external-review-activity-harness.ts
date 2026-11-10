import "server-only";
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

// Refuse anything except a dedicated local test database before importing the client.
const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
assert.match(url.pathname, /(^|[-_])test($|[-_])/);
const scenario = process.argv[2];
const [source, mode] = scenario.split(":");
url.searchParams.set("options", `-c timezone=${scenario === "timezone-berlin" ? "Europe/Berlin" : "UTC"}`);
process.env.DATABASE_URL = url.toString();
mock.module("server-only", () => ({}));
const dbModule = await import("@octopus/db");
const { prisma } = dbModule;
const activityModule = await import("../../external-review-activity");
const { startExternalReviewActivity: start, finishExternalReviewActivity: finish, withExternalReviewActivity: record } = activityModule;
const id = randomUUID();
const org = await prisma.organization.create({ data: { id, name: "fixture", slug: id } });
const repo = await prisma.repository.create({ data: { organizationId: id, name: "fixture", fullName: `${id}/fixture`, externalId: id, indexStatus: "indexed" } });
const accepted = new Date("2026-01-01T12:34:56.123Z");
const finished = new Date("2026-01-02T12:34:56.456Z");
const activity = { source: "github_action" as const, organizationId: id, repositoryId: repo.id };
const rows = () => prisma.externalReviewActivity.findMany({ where: { organizationId: id }, orderBy: { acceptedAt: "asc" } });
const migration = await readFile(new URL("../../../../../packages/db/prisma/migrations/20261022120000_external_review_activity/migration.sql", import.meta.url), "utf8");
const sentinel = new Error("fixture-failure");
let generationCalls = 0;
let releaseLock: (() => void) | undefined;
let heldLock: Promise<unknown> | undefined;
const originalLog = console.log;
// Existing handlers log content unrelated to recording; keep fixture output to assertions.
console.log = () => {};
console.error = () => { if (mode === "uncaught" && source !== "github_action") throw sentinel; };

try {
  if (scenario === "database" || scenario.startsWith("timezone-")) {
    for (const kind of ["github_action", "cli_local", "cli_repo"] as const) {
      const rowId = randomUUID();
      await start(rowId, { ...activity, source: kind, repositoryId: kind === "cli_local" ? null : repo.id }, accepted);
      const row = await prisma.externalReviewActivity.findUniqueOrThrow({ where: { id: rowId } });
      assert.equal(row.acceptedAt.toISOString(), accepted.toISOString());
      assert.equal(row.outcome, null); assert.equal(row.finishedAt, null);
      await finish(rowId, "generated", finished);
      const generated = await prisma.externalReviewActivity.findUniqueOrThrow({ where: { id: rowId } });
      assert.equal(generated.finishedAt?.toISOString(), finished.toISOString());
      await finish(rowId, "failed", new Date(finished.getTime() + 1));
      assert.deepEqual(await prisma.externalReviewActivity.findUniqueOrThrow({ where: { id: rowId } }), generated);
    }
    if (scenario === "database") {
      // INT bounds and non-numbers never alter the review request.
      for (const value of [undefined, 0, -1, "1", "invalid", 1.5, 2_147_483_648, Infinity, NaN, 1, 2_147_483_647]) {
        const rowId = randomUUID();
        await start(rowId, { ...activity, reportedPrNumber: value }, accepted);
        assert.equal((await prisma.externalReviewActivity.findUniqueOrThrow({ where: { id: rowId } })).reportedPrNumber,
          value === 1 || value === 2_147_483_647 ? value : null);
      }
      await finish(randomUUID(), "failed", finished); // Missing first write is a no-op.
      const before = await rows();
      await prisma.repository.delete({ where: { id: repo.id } });
      assert.deepEqual(await rows(), before);
      await prisma.organization.update({ where: { id }, data: { deletedAt: finished } });
      assert.deepEqual(await rows(), before);
      await prisma.organization.delete({ where: { id } });
      assert.equal((await rows()).length, 0);
    }
  } else if (scenario === "migration") {
    // Apply to a database containing existing organisation/repository data in an isolated schema.
    const schema = `external_${id.replaceAll("-", "")}`;
    const beforeOrg = await prisma.organization.findUniqueOrThrow({ where: { id } });
    const beforeRepo = await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } });
    try {
      await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
        for (const sql of migration.split(";").filter(s => s.trim())) await tx.$executeRawUnsafe(sql);
        await tx.$executeRaw`INSERT INTO external_review_activity (id, source, "organizationId", "repositoryId", "acceptedAt")
          VALUES (${randomUUID()}, 'github_action', ${id}, ${repo.id}, ${accepted}::timestamp)`;
        // Check the exact SQL migration, including constraints db:push cannot express.
        const invalid = [
          { source: "unknown" }, { source: "cli_local" },
          { source: "github_action", repositoryId: null }, { source: "cli_repo", repositoryId: null },
          { source: "cli_repo", reportedPrNumber: 1 }, { source: "cli_local", repositoryId: null, reportedPrNumber: 1 },
          { outcome: "unknown", finishedAt: finished }, { outcome: "generated" },
          { finishedAt: finished }, { outcome: "failed", finishedAt: new Date(accepted.getTime() - 1) },
          { reportedPrNumber: 0 },
        ];
        for (const overrides of invalid) {
          const row = { ...activity, reportedPrNumber: null as number | null, acceptedAt: accepted,
            outcome: null as string | null, finishedAt: null as Date | null, ...overrides };
          await tx.$executeRawUnsafe("SAVEPOINT invalid_activity");
          await assert.rejects(tx.$executeRaw`
            INSERT INTO external_review_activity
              (id, source, "organizationId", "repositoryId", "reportedPrNumber", "acceptedAt", outcome, "finishedAt")
            VALUES (${randomUUID()}, ${row.source}, ${row.organizationId}, ${row.repositoryId}, ${row.reportedPrNumber},
              ${row.acceptedAt}::timestamp, ${row.outcome}, ${row.finishedAt}::timestamp)
          `);
          await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT invalid_activity");
          await tx.$executeRawUnsafe("RELEASE SAVEPOINT invalid_activity");
        }
        const [count] = await tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM external_review_activity`;
        assert.equal(count.n, 1n);
      });
      assert.deepEqual(await prisma.organization.findUniqueOrThrow({ where: { id } }), beforeOrg);
      assert.deepEqual(await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } }), beforeRepo);
    } finally { await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
  } else if (scenario === "pool-exhaustion") {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let ready = 0;
    let allReady!: () => void;
    const acquired = new Promise<void>(resolve => { allReady = resolve; });
    const holders = Array.from({ length: 10 }, () => prisma.$transaction(async () => {
      if (++ready === 10) allReady();
      await blocked;
    }, { maxWait: 10_000, timeout: 10_000 }));
    await acquired;
    const before = performance.now();
    const response = await record(activity, async () => Response.json({ ok: true }));
    assert.equal(response.status, 200);
    assert.ok(performance.now() - before < 500, "pool exhaustion must not hold up a review");
    release(); await Promise.all(holders);
    assert.equal((await rows()).length, 0);
    // Allow late adapter acquisitions to settle, then ensure connections are usable.
    await new Promise(resolve => setTimeout(resolve, 50));
    await prisma.$queryRaw`SELECT 1`;
  } else {
    const rejected = mode === "401" || mode === "403";
    const overLimit = mode === "402";
    let community = false;
    const measuring = mode?.startsWith("latency-") ?? false;
    let observe = !measuring && mode !== "first-failure" && mode !== "lock";
    let recordingEnabled = true;
    if (measuring) mock.module("@/lib/external-review-activity", () => ({
      ...activityModule,
      withExternalReviewActivity: (input: Parameters<typeof record>[0], review: Parameters<typeof record>[1]) =>
        record(recordingEnabled ? input : null, review),
    }));
    class ReviewConfigError extends Error {}
    const result = { findings: [], summary: "", model: "fixture", usage: { inputTokens: 0, outputTokens: 0 } };
    const generate = async () => {
      generationCalls++;
      if (!community && observe) {
        const current = await rows();
        assert.equal(current.length, 1);
        assert.equal(current[0].source, source);
        assert.equal(current[0].organizationId, id);
        assert.equal(current[0].repositoryId, source === "cli_local" ? null : repo.id);
        assert.equal(current[0].outcome, null); assert.equal(current[0].finishedAt, null);
      }
      if (mode === "caught" || mode === "uncaught") throw sentinel;
      if (mode === "config") throw new ReviewConfigError("fixture-config");
      return result;
    };
    mock.module("@/lib/api-auth", () => ({ authenticateApiToken: async () => community ? null : rejected
      ? mode === "403" ? Response.json({ error: "fixture-hold" }, { status: 403 }) : null
      : { org, user: null } }));
    mock.module("@/lib/cost", () => ({ isOrgOverSpendLimit: async () => overLimit }));
    mock.module("@/lib/review-core", () => ({ generateLocalReview: generate, generateBareLocalReview: generate, ReviewConfigError }));
    mock.module("@/lib/audit", () => ({ writeAuditLog: async () => {} }));
    mock.module("next/headers", () => ({ headers: async () => new Headers() }));
    mock.module("@/lib/github", () => ({
      getRepositoryTree: async () => [],
      getRepositoryDetails: async () => ({ id, default_branch: "main", private: false }),
    }));
    mock.module("@/lib/events/bus", () => ({ eventBus: { emit: () => {} } }));
    let queued = 0;
    mock.module("@/lib/queue", () => ({ enqueue: async () => { queued++; } }));
    mock.module("@/lib/crypto", () => ({ encryptString: () => "fixture" }));
    mock.module("@/lib/community-pr-persist", () => ({ CommunityRepositoryChangedError: class extends Error {}, persistCommunityReviewToPR: async () => {} }));
    mock.module("@/lib/repository-index-completion", () => ({ runRepositoryIndex: async () => {} }));
    mock.module("@/lib/oss-bot", () => ({ isBotAccountConfigured: () => true, getBotToken: () => "fixture", hasConsentFile: async () => true }));
    // All network calls in route fixtures are intercepted; nothing leaves the process.
    globalThis.fetch = mock(async () => mode === "404"
      ? Response.json({}, { status: 404 })
      : Response.json({ id, default_branch: "main", private: false, state: "open", head: { sha: id }, base: { ref: "main" } })) as unknown as typeof fetch;
    let actionRepo = mode === "uncaught" && source === "github_action"
      ? { ...repo, indexedAt: { getTime() { throw sentinel; } } } as unknown as typeof repo
      : repo;
    const repository = new Proxy(prisma.repository, { get(target, property, receiver) {
      if (property === "upsert") return async () => actionRepo;
      // Keep identical admission work independent of the pool being deliberately exhausted.
      if (measuring && property === "findFirst") return async () => repo;
      return Reflect.get(target, property, receiver);
    } });
    mock.module("@octopus/db", () => ({ ...dbModule, prisma: new Proxy(prisma, { get(target, property, receiver) {
      return property === "repository" ? repository : Reflect.get(target, property, receiver);
    } }) }));
    const { NextRequest } = await import("next/server");
    const action = await import("../../../app/api/github-action/review/route");
    const bare = await import("../../../app/api/cli/review-local/route");
    const contextual = await import("../../../app/api/cli/repos/[id]/local-review/route");
    const call = (prNumber?: unknown) => {
      const body = { diff: "+", owner: id, repo: "fixture", githubToken: "fixture", prNumber };
      if (mode === "413") body.diff = "+".repeat(524_289);
      const request = new NextRequest("http://localhost/api/fixture", {
        method: "POST", headers: community ? {} : { authorization: "Bearer fixture" },
        body: mode === "400" ? "{" : JSON.stringify(body),
      });
      if (source === "github_action" || community) return action.POST(request);
      if (source === "cli_local") return bare.POST(request);
      return contextual.POST(request, { params: Promise.resolve({ id: mode === "404" ? randomUUID() : repo.id }) });
    };
    if (measuring) {
      // Time actual handler Response returns with the same stubbed generation,
      // admission and request body. Only recording is toggled between each pair.
      // Setup, response-body assertions, holder release and cleanup are excluded.
      const samples: Array<{ baselineMs: number; recordedMs: number; extraMs: number }> = [];
      for (let iteration = 0; iteration < 20; iteration++) {
        let release!: () => void;
        const blocked = new Promise<void>(resolve => { release = resolve; });
        const holders: Array<Promise<unknown>> = [];
        let acquired = 0;
        let allAcquired!: () => void;
        const ready = new Promise<void>(resolve => { allAcquired = resolve; });
        const holderCount = mode === "latency-pool" ? 10 : mode === "latency-lock" ? 1 : 0;
        try {
          for (let index = 0; index < holderCount; index++) holders.push(prisma.$transaction(async tx => {
            if (mode === "latency-lock") await tx.$executeRawUnsafe("LOCK TABLE external_review_activity IN ACCESS EXCLUSIVE MODE");
            if (++acquired === holderCount) allAcquired();
            await blocked;
          }, { maxWait: 10_000, timeout: 10_000 }));
          if (holderCount) await ready;
          const measure = async (enabled: boolean) => {
            recordingEnabled = enabled;
            const before = performance.now();
            const response = await call(7);
            const elapsed = performance.now() - before;
            assert.equal(response.status, 200);
            const body = await response.json();
            assert.deepEqual(body, source === "github_action"
              ? { status: "completed", ...result, indexed: false, community: false, firstCommunityReview: false }
              : source === "cli_local" ? { ...result, bareMode: true } : result);
            if (enabled && mode !== "latency-normal") assert.ok(elapsed < 500, "recording must return the response within 500ms under contention");
            return elapsed;
          };
          // Alternate ordering to reduce systematic warm-up/order bias.
          let baselineMs: number, recordedMs: number;
          if (iteration % 2 === 0) {
            baselineMs = await measure(false); recordedMs = await measure(true);
          } else {
            recordedMs = await measure(true); baselineMs = await measure(false);
          }
          samples.push({ baselineMs, recordedMs, extraMs: recordedMs - baselineMs });
        } finally {
          release(); await Promise.all(holders);
          // Let abandoned pool acquisitions settle outside the measured interval.
          if (mode === "latency-pool") await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      const current = await rows();
      assert.equal(current.length, mode === "latency-normal" ? 20 : 0);
      assert.ok(current.every(row => row.outcome === "generated"));
      const sorted = samples.map(sample => sample.extraMs).sort((a, b) => a - b);
      originalLog(JSON.stringify({ source, condition: mode.slice("latency-".length), count: samples.length,
        medianMs: (sorted[9] + sorted[10]) / 2, maxMs: sorted.at(-1), samples }));
    } else if (scenario === "out-of-scope") {
      const before = await prisma.externalReviewActivity.count();
      community = true; observe = false;
      assert.equal((await call()).status, 200);
      const communityOrg = await prisma.organization.findUniqueOrThrow({ where: { slug: `community-${id}` } });
      await prisma.repository.update({ where: { id: repo.id }, data: { organizationId: communityOrg.id, indexStatus: "pending" } });
      actionRepo = { ...repo, organizationId: communityOrg.id, indexStatus: "pending" };
      assert.equal((await (await call()).json()).status, "queued");
      const job = await prisma.communityReviewJob.findFirstOrThrow({ where: { repositoryId: repo.id } });
      assert.equal(job.repositoryExternalId, repo.externalId);
      const poll = await import("../../../app/api/github-action/review/[jobId]/route");
      assert.equal((await poll.GET(new NextRequest(`http://localhost/api/fixture?repo=${id}/fixture`), {
        params: Promise.resolve({ jobId: job.id }),
      })).status, 200);
      const priorOrg = await prisma.organization.create({ data: { name: "Prior synthetic tenant", slug: `prior-${id}` } });
      await prisma.communityReviewJob.update({ where: { id: job.id }, data: { status: "completed", summary: "synthetic result" } });
      const completed = await poll.GET(new NextRequest(`http://localhost/api/fixture?repo=${id}/fixture`), {
        params: Promise.resolve({ jobId: job.id }),
      });
      assert.equal(completed.status, 200);
      const completedBody = await completed.json();
      assert.equal(completedBody.summary, "synthetic result");
      assert.equal(completedBody.githubToken, undefined);
      try {
        await prisma.repository.update({ where: { id: repo.id }, data: { organizationId: priorOrg.id } });
        const transferred = await poll.GET(new NextRequest(`http://localhost/api/fixture?repo=${id}/fixture`), {
          params: Promise.resolve({ jobId: job.id }),
        });
        assert.equal(transferred.status, 404);
        assert.equal((await transferred.json()).summary, undefined);
      } finally {
        await prisma.repository.update({ where: { id: repo.id }, data: { organizationId: communityOrg.id } });
      }
      for (const changed of [
        { externalId: `changed-${id}` }, { provider: "gitlab" }, { fullName: `${id}/renamed` },
      ]) {
        try {
          await prisma.repository.update({ where: { id: repo.id }, data: changed });
          assert.equal((await poll.GET(new NextRequest(`http://localhost/api/fixture?repo=${id}/fixture`), {
            params: Promise.resolve({ jobId: job.id }),
          })).status, 404);
        } finally {
          await prisma.repository.update({ where: { id: repo.id }, data: {
            externalId: repo.externalId, provider: repo.provider, fullName: repo.fullName,
          } });
        }
      }
      await prisma.communityReviewJob.update({ where: { id: job.id }, data: { repositoryExternalId: null } });
      assert.equal((await poll.GET(new NextRequest(`http://localhost/api/fixture?repo=${id}/fixture`), {
        params: Promise.resolve({ jobId: job.id }),
      })).status, 200);
      await prisma.communityReviewJob.update({ where: { id: job.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      assert.equal((await poll.GET(new NextRequest(`http://localhost/api/fixture?repo=${id}/fixture`), {
        params: Promise.resolve({ jobId: job.id }),
      })).status, 410);
      await prisma.communityReviewJob.update({ where: { id: job.id }, data: { expiresAt: new Date(Date.now() + 60_000) } });
      {
        let locked!: () => void;
        let release!: () => void;
        const ready = new Promise<void>(resolve => { locked = resolve; });
        const proceed = new Promise<void>(resolve => { release = resolve; });
        const transfer = prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM repositories WHERE id = ${repo.id} FOR UPDATE`;
          locked();
          await proceed;
          await tx.repository.update({ where: { id: repo.id }, data: { organizationId: priorOrg.id } });
        });
        await ready;
        const duringTransfer = poll.GET(new NextRequest(`http://localhost/api/fixture?repo=${id}/fixture`), {
          params: Promise.resolve({ jobId: job.id }),
        });
        try {
          let waiting = false;
          for (let attempt = 0; attempt < 100; attempt++) {
            const [row] = await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%repositories%'`;
            if (row.count) { waiting = true; break; }
            await Bun.sleep(20);
          }
          assert.ok(waiting, "poll must wait for the repository transfer lock");
          release();
          await transfer;
          const rejected = await duringTransfer;
          assert.equal(rejected.status, 404);
          assert.equal((await rejected.json()).summary, undefined);
        } finally {
          release();
          await Promise.allSettled([transfer, duringTransfer]);
          await prisma.repository.update({ where: { id: repo.id }, data: { organizationId: communityOrg.id } });
        }
      }
      {
        await prisma.communityReviewJob.update({ where: { id: job.id }, data: { status: "reviewing", summary: null } });
        let locked!: () => void;
        let release!: () => void;
        const ready = new Promise<void>(resolve => { locked = resolve; });
        const proceed = new Promise<void>(resolve => { release = resolve; });
        const completion = prisma.$transaction(async tx => {
          await tx.communityReviewJob.update({ where: { id: job.id }, data: { status: "completed", summary: "synthetic completion" } });
          locked();
          await proceed;
        });
        await ready;
        const duringCompletion = poll.GET(new NextRequest(`http://localhost/api/fixture?repo=${id}/fixture`), {
          params: Promise.resolve({ jobId: job.id }),
        });
        try {
          let waiting = false;
          for (let attempt = 0; attempt < 100; attempt++) {
            const [row] = await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%community_review_jobs%'`;
            if (row.count) { waiting = true; break; }
            await Bun.sleep(20);
          }
          assert.ok(waiting, "poll must wait for the job completion lock");
          release();
          await completion;
          const result = await duringCompletion;
          assert.equal(result.status, 200);
          assert.equal((await result.json()).summary, "synthetic completion");
        } finally {
          release();
          await Promise.allSettled([completion, duringCompletion]);
        }
      }
      await prisma.communityReviewJob.deleteMany({ where: { repositoryId: repo.id } });
      await prisma.ossReviewAllowlist.create({ data: { repoFullName: `${id}/fixture` } });
      const oldBotJob = await prisma.communityReviewJob.create({ data: { repositoryId: repo.id, organizationId: priorOrg.id,
        repoFullName: repo.fullName, repositoryExternalId: repo.externalId, status: "indexing", prNumber: 1,
        headSha: id, diff: "synthetic", expiresAt: new Date(Date.now() + 60_000) } });
      const oss = await import("../../../app/api/oss-review/route");
      const botPost = async (prNumber: number) => {
        const response = await oss.POST(new NextRequest("http://localhost/api/fixture", {
          method: "POST", body: JSON.stringify({ owner: id, repo: "fixture", prNumber }),
        }));
        return { http: response.status, ...await response.json() };
      };
      const actionPost = async (prNumber: number) => {
        const response = await action.POST(new NextRequest("http://localhost/api/fixture", {
          method: "POST", body: JSON.stringify({ owner: id, repo: "fixture", prNumber, headSha: id, diff: "+", githubToken: "synthetic" }),
        }));
        return { http: response.status, ...await response.json() };
      };
      const blockedBot = await botPost(1);
      assert.equal(blockedBot.http, 409);
      assert.equal(blockedBot.jobId, undefined);
      assert.equal(queued, 1);
      await prisma.communityReviewJob.update({ where: { id: oldBotJob.id }, data: { status: "failed" } });
      const botResult = await botPost(1);
      assert.equal(botResult.status, "queued");
      assert.notEqual(botResult.jobId, oldBotJob.id);
      const botJob = await prisma.communityReviewJob.findUniqueOrThrow({ where: { id: botResult.jobId } });
      assert.equal(botJob.organizationId, communityOrg.id);
      assert.equal(botJob.repositoryExternalId, repo.externalId);
      assert.equal((await botPost(1)).jobId, botJob.id);
      const actionAgainstBot = await actionPost(1);
      assert.equal(actionAgainstBot.http, 409);
      assert.equal(actionAgainstBot.jobId, undefined);
      assert.equal(queued, 2);
      const oldActionJob = await prisma.communityReviewJob.create({ data: { repositoryId: repo.id, organizationId: priorOrg.id,
        repoFullName: repo.fullName, repositoryExternalId: repo.externalId, status: "indexing", prNumber: 2,
        headSha: id, diff: "synthetic", expiresAt: new Date(Date.now() + 60_000) } });
      const blockedAction = await actionPost(2);
      assert.equal(blockedAction.http, 409);
      assert.equal(blockedAction.jobId, undefined);
      assert.equal(queued, 2);
      await prisma.communityReviewJob.update({ where: { id: oldActionJob.id }, data: { status: "failed" } });
      const actionResult = await actionPost(2);
      assert.equal(actionResult.status, "queued");
      assert.notEqual(actionResult.jobId, oldActionJob.id);
      const actionJob = await prisma.communityReviewJob.findUniqueOrThrow({ where: { id: actionResult.jobId } });
      assert.equal(actionJob.organizationId, communityOrg.id);
      assert.equal(actionJob.repositoryExternalId, repo.externalId);
      assert.equal((await actionPost(2)).jobId, actionJob.id);
      const botAgainstAction = await botPost(2);
      assert.equal(botAgainstAction.http, 409);
      assert.equal(botAgainstAction.jobId, undefined);
      assert.equal(queued, 3);

      for (const [prNumber, postMode] of [[3, "action_client"], [4, "bot_account"]] as const) {
        const legacy = await prisma.communityReviewJob.create({ data: { repositoryId: repo.id, organizationId: communityOrg.id,
          repoFullName: repo.fullName.toUpperCase(), status: "indexing", postMode, prNumber, headSha: id,
          diff: "synthetic", expiresAt: new Date(Date.now() + 60_000) } });
        assert.equal((await (postMode === "action_client" ? actionPost(prNumber) : botPost(prNumber))).jobId, legacy.id);
        assert.equal((await poll.GET(new NextRequest(`http://localhost/api/fixture?repo=${id}/fixture`), {
          params: Promise.resolve({ jobId: legacy.id }),
        })).status, 200);
        assert.equal((await poll.GET(new NextRequest("http://localhost/api/fixture?repo=other/fixture"), {
          params: Promise.resolve({ jobId: legacy.id }),
        })).status, 403);
      }
      for (const [prNumber, postMode] of [[5, "action_client"], [6, "bot_account"]] as const) {
        const different = await prisma.communityReviewJob.create({ data: { repositoryId: repo.id, organizationId: communityOrg.id,
          repoFullName: repo.fullName, repositoryExternalId: `previous-${id}`, status: "indexing", postMode,
          prNumber, headSha: id, diff: "synthetic", expiresAt: new Date(Date.now() + (prNumber === 5 ? -1000 : 60_000)) } });
        const post = () => postMode === "action_client" ? actionPost(prNumber) : botPost(prNumber);
        const blocked = await post();
        assert.equal(blocked.http, 409);
        assert.equal(blocked.jobId, undefined);
        await prisma.communityReviewJob.update({ where: { id: different.id }, data: { status: "failed" } });
        const result = await post();
        assert.equal(result.status, "queued");
        assert.notEqual(result.jobId, different.id);
        assert.equal((await prisma.communityReviewJob.findUniqueOrThrow({ where: { id: result.jobId } })).repositoryExternalId, repo.externalId);
      }
      const concurrent = await Promise.all([actionPost(7), actionPost(7)]);
      assert.equal(concurrent[0].jobId, concurrent[1].jobId);
      assert.deepEqual(concurrent.map(result => result.existing).sort(), [false, true]);
      assert.equal(queued, 6);

      let locked!: () => void;
      let release!: () => void;
      const ready = new Promise<void>(resolve => { locked = resolve; });
      const proceed = new Promise<void>(resolve => { release = resolve; });
      const transfer = prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM repositories WHERE id = ${repo.id} FOR UPDATE`;
        locked();
        await proceed;
        await tx.repository.update({ where: { id: repo.id }, data: { organizationId: priorOrg.id } });
      });
      await ready;
      const duringTransfer = actionPost(8);
      try {
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const [row] = await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%repositories%'`;
          if (row.count) { waiting = true; break; }
          await Bun.sleep(20);
        }
        assert.ok(waiting, "enqueue must wait for the repository transfer lock");
        release();
        await transfer;
        const rejected = await duringTransfer;
        assert.equal(rejected.http, 409);
        assert.equal(rejected.jobId, undefined);
        assert.equal(queued, 6);
      } finally {
        release();
        await Promise.allSettled([transfer, duringTransfer]);
        await prisma.repository.update({ where: { id: repo.id }, data: { organizationId: communityOrg.id } });
      }
      await prisma.communityReviewJob.deleteMany({ where: { organizationId: priorOrg.id } });
      await prisma.organization.delete({ where: { id: priorOrg.id } });
      // Exercise the actual CLI --pr dispatch with a stub transport.
      mock.module("../../../../cli/src/lib/credentials", () => ({ loadCredentials: async () => ({ baseUrl: "http://localhost", token: "fixture" }) }));
      mock.module("../../../../cli/src/lib/repo-resolver", () => ({ resolveRepo: async () => ({ ok: true, repo: { ...repo, provider: "github" } }) }));
      mock.module("../../../../cli/src/lib/api", () => ({
        getJson: async () => { throw sentinel; },
        postJson: async (endpoint: string) => {
          assert.ok(endpoint.endsWith(`/api/cli/repos/${repo.id}/review`));
          return { ok: true, data: { ok: true } };
        },
      }));
      const { reviewCommand } = await import("../../../../cli/src/commands/review");
      assert.equal(await reviewCommand(["--pr", "1"]), 0);
      assert.equal(await prisma.externalReviewActivity.count(), before);
    } else {
      if (mode === "first-failure" || mode === "second-failure") {
        await prisma.$executeRawUnsafe(`CREATE FUNCTION external_activity_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER external_activity_fail BEFORE ${mode === "first-failure" ? "INSERT" : "UPDATE"} ON external_review_activity FOR EACH ROW EXECUTE FUNCTION external_activity_fail()`);
      }
      if (mode === "lock") {
        let acquired!: () => void;
        const ready = new Promise<void>(resolve => { acquired = resolve; });
        const blocked = new Promise<void>(resolve => { releaseLock = resolve; });
        heldLock = prisma.$transaction(async tx => {
          await tx.$executeRawUnsafe("LOCK TABLE external_review_activity IN ACCESS EXCLUSIVE MODE");
          acquired(); await blocked;
        }, { timeout: 10_000 });
        await ready;
      }
      const before = performance.now();
      if (mode === "uncaught") {
        await assert.rejects(call(7), error => error === sentinel);
      } else {
        const response = await call(7);
        const expectedStatus = /^\d+$/.test(mode) ? Number(mode) : mode === "caught" ? 500
          : mode === "config" ? source === "github_action" ? 500 : 422 : 200;
        assert.equal(response.status, expectedStatus);
        const json = await response.json();
        if (expectedStatus === 200) assert.deepEqual(json, source === "github_action"
          ? { status: "completed", ...result, indexed: false, community: false, firstCommunityReview: false }
          : source === "cli_local" ? { ...result, bareMode: true } : result);
        if (mode === "config") assert.deepEqual(json, { error: source === "github_action" ? "Review generation failed" : "fixture-config" });
        if (mode === "caught") assert.deepEqual(json, { error: "Review generation failed" });
      }
      if (mode === "lock") {
        assert.ok(performance.now() - before < 500, "lock timeout must let generation continue");
        releaseLock!(); await heldLock; heldLock = undefined;
      }
      const current = await rows();
      const noRow = /^\d+$/.test(mode) || mode === "first-failure" || mode === "lock";
      assert.equal(current.length, noRow ? 0 : 1);
      if (!noRow) {
        assert.equal(current[0].outcome, mode === "second-failure" ? null : ["caught", "config", "uncaught"].includes(mode) ? "failed" : "generated");
        assert.equal(current[0].finishedAt === null, mode === "second-failure");
        assert.equal(current[0].reportedPrNumber, source === "github_action" ? 7 : null);
      }
      assert.equal(generationCalls, /^\d+$/.test(mode) || (mode === "uncaught" && source === "github_action") ? 0 : 1);
      assert.equal(queued, 0);
      if (mode === "no-dedup") {
        observe = false; await call(7);
        const two = await rows(); assert.equal(two.length, 2); assert.notEqual(two[0].id, two[1].id);
        assert.ok(two.every(row => row.outcome === "generated"));
      }
      if (source === "github_action" && mode === "generated") {
        observe = false;
        for (const value of [undefined, 0, -1, "invalid", 1.5, 2_147_483_648, 2_147_483_647]) {
          const response = await call(value); assert.equal(response.status, 200);
          assert.deepEqual(await response.json(), { status: "completed", ...result, indexed: false, community: false, firstCommunityReview: false });
          const all = await rows();
          assert.equal(all.at(-1)!.reportedPrNumber, value === 2_147_483_647 ? value : null);
        }
      }
    }
  }
} finally {
  console.log = originalLog;
  releaseLock?.(); await heldLock;
  await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS external_activity_fail ON external_review_activity");
  await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS external_activity_fail()");
  await prisma.communityReviewJob.deleteMany({ where: { repositoryId: repo.id } });
  await prisma.ossReviewAllowlist.deleteMany({ where: { repoFullName: `${id}/fixture` } });
  await prisma.organization.deleteMany({ where: { id } });
  await prisma.organization.deleteMany({ where: { slug: `community-${id}` } });
  await prisma.$disconnect();
}
