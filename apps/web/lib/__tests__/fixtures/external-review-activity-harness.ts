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
const { startExternalReviewActivity: start, finishExternalReviewActivity: finish, withExternalReviewActivity: record } = await import("../../external-review-activity");
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
    assert.ok(performance.now() - before < 1000, "pool exhaustion must not hold up a review");
    release(); await Promise.all(holders);
    assert.equal((await rows()).length, 0);
    // Allow late adapter acquisitions to settle, then ensure connections are usable.
    await new Promise(resolve => setTimeout(resolve, 50));
    await prisma.$queryRaw`SELECT 1`;
  } else {
    const rejected = mode === "401" || mode === "403";
    const overLimit = mode === "402";
    let community = false;
    let observe = mode !== "first-failure" && mode !== "lock";
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
    mock.module("@/lib/community-pr-persist", () => ({ persistCommunityReviewToPR: async () => {} }));
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
    if (scenario === "out-of-scope") {
      const before = await prisma.externalReviewActivity.count();
      community = true; observe = false;
      assert.equal((await call()).status, 200);
      await prisma.repository.update({ where: { id: repo.id }, data: { indexStatus: "pending" } });
      actionRepo = { ...repo, indexStatus: "pending" };
      assert.equal((await (await call()).json()).status, "queued");
      const job = await prisma.communityReviewJob.findFirstOrThrow({ where: { repositoryId: repo.id } });
      const poll = await import("../../../app/api/github-action/review/[jobId]/route");
      assert.equal((await poll.GET(new NextRequest(`http://localhost/api/fixture?repo=${id}/fixture`), {
        params: Promise.resolve({ jobId: job.id }),
      })).status, 200);
      await prisma.communityReviewJob.deleteMany({ where: { repositoryId: repo.id } });
      await prisma.ossReviewAllowlist.create({ data: { repoFullName: `${id}/fixture` } });
      const oss = await import("../../../app/api/oss-review/route");
      assert.equal((await (await oss.POST(new NextRequest("http://localhost/api/fixture", {
        method: "POST", body: JSON.stringify({ owner: id, repo: "fixture", prNumber: 1 }),
      }))).json()).status, "queued");
      assert.equal(queued, 2);
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
        if (mode === "caught") assert.deepEqual(json, { error: source === "github_action" ? "Review generation failed" : "Review generation failed: fixture-failure" });
      }
      if (mode === "lock") {
        assert.ok(performance.now() - before < 1000, "lock timeout must let generation continue");
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
