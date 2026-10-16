import { mock, spyOn } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ReviewCoverage } from "../../review-coverage";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
assert.match(url.pathname, /(^|[-_])test($|[-_])/);
const scenario = process.argv[2];
const timezone = scenario === "timezone-berlin" ? "Europe/Berlin" : "UTC";
url.searchParams.set("options", `-c timezone=${timezone}`);
process.env.DATABASE_URL = url.toString();
mock.module("server-only", () => ({}));
const dbModule = await import("@octopus/db");
const { prisma } = dbModule;
let interceptTransaction: (() => Promise<never>) | undefined;
if (scenario === "admission-failure" || scenario === "admission-slow") {
  const recordingClient = new Proxy(prisma, { get(target, property, receiver) {
    if (property === "$transaction" && interceptTransaction) return interceptTransaction;
    return Reflect.get(target, property, receiver);
  } });
  mock.module("@octopus/db", () => ({ ...dbModule, prisma: recordingClient }));
}
const { reviewKind, mainCommentFailure, startReviewOutcome: start, finishReviewOutcome: finish, supersedeReviewOutcomes: supersede,
  deferReviewOutcome: defer, recordReviewAdmissionAfterCommit, ReviewOutcomeRecorder } = await import("../../review-attempt-outcome");
const id = randomUUID();
const org = await prisma.organization.create({ data: { name: "Review outcome fixture", slug: `review-outcome-test-${id}` } });
const repo = await prisma.repository.create({ data: { organizationId: org.id, name: "Review fixture", fullName: "fixture/review", externalId: id } });
const pr = await prisma.pullRequest.create({ data: { repositoryId: repo.id, number: 1, title: "Synthetic fixture", url: "", author: "fixture", headSha: "a".repeat(40), reviewRequestVersion: 1 } });
const key = { organizationId: org.id, repositoryId: repo.id, pullRequestId: pr.id, requestVersion: 1 };
const early = new Date("2026-01-01T12:34:56.123Z");
const late = new Date("2026-01-02T12:34:56.456Z");
const latest = new Date("2026-01-03T12:34:56.789Z");
const archive = randomUUID();
const read = (version = 1) => prisma.reviewAttemptOutcome.findUniqueOrThrow({ where: { pullRequestId_requestVersion: { pullRequestId: pr.id, requestVersion: version } } });
const coverage = (options: { complete?: boolean; state?: string; files?: string[]; expected?: number | null; inventory?: boolean } = {}): ReviewCoverage => ({
  version: 1, provider: "github", headSha: "a".repeat(40), baseSha: "b".repeat(40),
  inventoryComplete: options.inventory ?? true, expectedFiles: options.expected === undefined ? 1 : options.expected,
  complete: options.complete ?? true, limitations: [],
  files: (options.files ?? ["supplied"]).map(state => ({ path: "fixture.ts", change: "modified", state, patchSha256: null, suppliedSha256: null, suppliedChars: 1, hunks: [] })),
  assessment: { state: options.state ?? "completed", requests: [], model: null, reason: "fixture", policySha256: "fixture", templateSha256: "fixture", responseSha256: null, completion: null },
} as ReviewCoverage);
const recorder = () => { const r = new ReviewOutcomeRecorder(key); r.assessment(coverage(), archive); return r; };
const reject = () => { throw new Error("Failed to create PR comment: 403"); };
async function productionClaim() {
  const source = await readFile(new URL("../../reviewer.ts", import.meta.url), "utf8");
  const begin = source.indexOf("  const outcomeKey =", source.indexOf("async function processReviewInternal"));
  const end = source.indexOf("  if (claimed.count === 0)", begin);
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(`(async () => { ${source.slice(begin, end)} return claimed; })()`);
  const fn = new Function("prisma", "pr", "pullRequestId", "startReviewOutcome", `const reviewingStale = new Date(0), queuedStale = new Date(0); return ${js}`);
  return fn(prisma, { ...pr, repository: { ...repo, organization: org } }, pr.id, start) as Promise<{ count: number }>;
}
const migration = await readFile(new URL("../../../../../packages/db/prisma/migrations/20261016120000_review_attempt_outcomes/migration.sql", import.meta.url), "utf8");

try {
  await start(key, early);
  if (["substantive", "zero-findings", "partial", "incomplete", "not-required", "empty", "unavailable", "large", "not-assessed"].includes(scenario)) {
    const cases: Record<string, [ReviewCoverage | undefined, boolean, string]> = {
      substantive: [coverage(), false, "substantive"], "zero-findings": [coverage(), false, "substantive"],
      partial: [coverage({ complete: false, files: ["partial"] }), false, "partial"],
      incomplete: [coverage({ state: "incomplete" }), false, "incomplete"],
      "not-required": [coverage({ state: "not-required", files: ["excluded"] }), false, "not_required"],
      empty: [coverage({ files: [], expected: 0, state: "incomplete" }), false, "empty"],
      unavailable: [coverage({ files: ["unavailable"], complete: false, state: "incomplete" }), false, "incomplete"],
      large: [coverage(), true, "unknown"], "not-assessed": [undefined, false, "not_assessed"],
    };
    const [initialCoverage, large, expected] = cases[scenario];
    let c = initialCoverage;
    const { prepareReviewInput } = await import("../../review-coverage");
    const { executeCoveredReview, recordNoModelAssessment } = await import("../../review-assessment");
    if (scenario === "partial") {
      c = prepareReviewInput({ provider: "github", headSha: "a".repeat(40), baseSha: "b".repeat(40),
        inventoryComplete: true, expectedFiles: 2, limitations: [], files: ["a.ts", "b.ts"].map(path => ({
          path, change: "modified" as const, patch: "@@ -1 +1 @@\n-old\n+new\n", additions: 1, deletions: 1,
        })) }, { maxChars: 100 }).coverage;
      assert.ok(c.files.some(f => f.state === "omitted" || f.state === "partial"));
      c.assessment = coverage().assessment;
    }
    if (scenario === "incomplete") {
      await executeCoveredReview({ model: "fixture", maxTokens: 128, messages: [] }, c!, "fixture", async () => ({
        text: "invalid review output", model: "fixture", provider: "anthropic", inputTokens: 1, outputTokens: 1,
        completion: { state: "completed", reason: "end_turn" },
      }));
    }
    if (scenario === "not-required" || scenario === "empty" || scenario === "unavailable") recordNoModelAssessment(c!);
    if (scenario === "substantive") await prisma.reviewIssue.create({ data: {
      pullRequestId: pr.id, title: "Synthetic finding", description: "Synthetic fixture", severity: "low",
    } });
    if (scenario === "zero-findings") assert.equal(await prisma.reviewIssue.count({ where: { pullRequestId: pr.id } }), 0);
    const r = new ReviewOutcomeRecorder(key, large); r.assessment(c, c ? archive : null);
    if (scenario === "not-assessed") await r.finish(late); else await r.publish(async () => 1);
    assert.equal(reviewKind(c, large), expected); assert.equal((await read()).kind, expected);
    assert.equal((await read()).outcome, scenario === "not-assessed" ? "failed" : "published");
    assert.notEqual(reviewKind(coverage({ files: ["omitted"], complete: false, state: "incomplete" })), "empty");
    assert.notEqual(reviewKind(coverage({ files: [], inventory: false, complete: false, expected: null })), "empty");
  } else if (scenario === "completed-not-published") {
    await prisma.pullRequest.update({ where: { id: pr.id }, data: { status: "completed" } });
    await assert.rejects(recorder().publish(async () => reject()));
    assert.equal((await read()).outcome, "failed"); assert.equal((await read()).publishedAt, null);
  } else if (scenario === "uncertain-retry") {
    await assert.rejects(recorder().publish(async () => { throw new Error("timeout"); }));
    assert.equal((await read()).outcome, "uncertain");
    await start(key, late); await recorder().publish(async () => 1);
    assert.equal((await read()).outcome, "published"); assert.equal((await read()).tries, 2);
  } else if (scenario === "inline-fallback") {
    const r = recorder(); // Failed inline operations never acknowledge an inline post.
    await r.publish(async () => 1); assert.equal((await read()).outcome, "published");
  } else if (scenario === "partially-published") {
    const r = recorder(); r.inlinePosted(); await assert.rejects(r.publish(async () => reject()));
    assert.equal((await read()).outcome, "partially_published");
  } else if (scenario === "retry" || scenario === "restart") {
    if (scenario === "retry") await assert.rejects(recorder().publish(async () => reject()));
    await start(key, late); await recorder().publish(async () => 1);
    const row = await read(); assert.equal(row.tries, 2); assert.equal(row.firstTriedAt.toISOString(), early.toISOString());
    assert.equal(await prisma.reviewAttemptOutcome.count({ where: { pullRequestId: pr.id } }), 1);
  } else if (["new-version", "superseded", "published-admission", "superseded-published"].includes(scenario)) {
    if (scenario === "published-admission") await finish(key, "substantive", "published", archive, late);
    await supersede(pr.id, 2, latest);
    assert.equal((await read()).outcome, scenario === "published-admission" ? "published" : "superseded");
    if (scenario === "new-version") { await start({ ...key, requestVersion: 2 }, late); assert.equal((await read(2)).tries, 1); }
    if (scenario === "superseded-published") { await recorder().publish(async () => 1); assert.equal((await read()).outcome, "published"); }
  } else if (scenario === "last-assessment") {
    const firstCoverage = coverage({ complete: false, files: ["partial"] });
    await prisma.reviewAttempt.create({ data: { id: archive, pullRequestId: pr.id, coverage: JSON.parse(JSON.stringify(firstCoverage)), reviewBody: "Synthetic partial assessment" } });
    await finish(key, reviewKind(firstCoverage), "failed", archive, early);
    await start(key, late); const second = randomUUID(); const secondCoverage = coverage();
    await prisma.reviewAttempt.create({ data: { id: second, pullRequestId: pr.id, coverage: JSON.parse(JSON.stringify(secondCoverage)), reviewBody: "Synthetic complete assessment" } });
    await finish(key, reviewKind(secondCoverage), "published", second, latest);
    assert.equal((await read()).kind, "substantive"); assert.equal((await read()).resultArchiveId, second);
  } else if (scenario === "concurrent") {
    await Promise.all([start(key, late), start(key, latest)]);
    assert.equal(await prisma.reviewAttemptOutcome.count({ where: { pullRequestId: pr.id } }), 1);
    assert.equal((await read()).tries, 3);
    await Promise.all([finish(key, "substantive", "published", archive, late), finish(key, "incomplete", "failed", null, latest)]);
    assert.equal((await read()).outcome, "published"); assert.equal((await read()).resultArchiveId, archive);
  } else if (scenario === "late-failure" || scenario === "stale-try") {
    await finish(key, "substantive", "published", archive, late); const before = await read();
    await finish(key, "incomplete", "failed", null, latest); await start(key, latest);
    assert.deepEqual(await read(), before);
  } else if (scenario === "deferral") {
    await defer(key); assert.equal(await prisma.reviewAttemptOutcome.count({ where: { pullRequestId: pr.id } }), 0);
    await start(key, late); await finish(key, "partial", "failed", archive, late);
    await start(key, latest); await defer(key); assert.equal((await read()).tries, 1);
  } else if (scenario === "retention") {
    const other = await prisma.organization.create({ data: { name: "Retention fixture", slug: `retention-test-${id}` } });
    try {
      await prisma.repository.update({ where: { id: repo.id }, data: { organizationId: other.id } });
      await prisma.pullRequest.delete({ where: { id: pr.id } }); assert.equal((await read()).organizationId, org.id);
      await prisma.organization.update({ where: { id: org.id }, data: { deletedAt: late } }); assert.equal((await read()).organizationId, org.id);
      await prisma.organization.delete({ where: { id: org.id } }); assert.equal(await prisma.reviewAttemptOutcome.count({ where: { pullRequestId: pr.id } }), 0);
    } finally { await prisma.organization.delete({ where: { id: other.id } }); }
  } else if (scenario === "recording-failure") {
    // An unavailable table cannot prevent the real publication observer running.
    await prisma.$executeRawUnsafe('ALTER TABLE review_attempt_outcomes RENAME TO review_outcomes_unavailable');
    let posted = false;
    try { assert.equal((await productionClaim()).count, 1); await recorder().publish(async () => { posted = true; return 1; }); await start(key, late); }
    finally { await prisma.$executeRawUnsafe('ALTER TABLE review_outcomes_unavailable RENAME TO review_attempt_outcomes'); }
    assert.ok(posted);
    const r = recorder();
    await prisma.$executeRawUnsafe('ALTER TABLE review_attempt_outcomes RENAME TO review_outcomes_unavailable');
    try { await r.publish(async () => 1); }
    finally { await prisma.$executeRawUnsafe('ALTER TABLE review_outcomes_unavailable RENAME TO review_attempt_outcomes'); }
    r.assessment(coverage({ state: "incomplete" }), randomUUID());
    await r.finish(late);
    assert.equal((await read()).kind, "substantive"); assert.equal((await read()).resultArchiveId, archive);
  } else if (scenario === "savepoint") {
    await prisma.$transaction(async tx => {
      await start({ ...key, organizationId: "missing-fixture" }, late, tx);
      await tx.pullRequest.update({ where: { id: pr.id }, data: { status: "completed" } });
    });
    assert.equal((await prisma.pullRequest.findUniqueOrThrow({ where: { id: pr.id } })).status, "completed");
  } else if (scenario === "bounded-lock") {
    let release!: () => void; let locked!: () => void;
    const ready = new Promise<void>(r => { locked = r; }); const done = new Promise<void>(r => { release = r; });
    const holding = prisma.$transaction(async tx => { await tx.$executeRaw`UPDATE review_attempt_outcomes SET kind = kind WHERE "pullRequestId" = ${pr.id}`; locked(); await done; });
    await ready; const before = performance.now();
    try { await finish(key, "substantive", "published", archive, late); assert.ok(performance.now() - before < 500); }
    finally { release(); await holding; }
    assert.equal((await read()).outcome, null);
  } else if (scenario.startsWith("timezone-")) {
    assert.equal((await prisma.$queryRaw<Array<{ TimeZone: string }>>`SHOW TimeZone`)[0].TimeZone, timezone);
    await finish(key, "partial", "failed", archive, late);
    await finish(key, "incomplete", "failed", archive, latest);
    assert.equal((await read()).finishedAt?.toISOString(), late.toISOString());
    await finish(key, "substantive", "published", archive, latest);
    const rows = await prisma.$queryRaw<Array<{ first: string; finished: string; published: string }>>`
      SELECT "firstTriedAt"::text AS first, "finishedAt"::text AS finished, "publishedAt"::text AS published
      FROM review_attempt_outcomes WHERE "pullRequestId" = ${pr.id}`;
    const text = (date: Date) => date.toISOString().replace("T", " ").slice(0, -1);
    assert.deepEqual(rows, [{ first: text(early), finished: text(latest), published: text(latest) }]);
  } else if (scenario === "migration") {
    await prisma.$transaction(async tx => {
      const schema = `review_migration_${id.replaceAll("-", "")}`;
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$executeRawUnsafe('CREATE TABLE organizations (id TEXT PRIMARY KEY); CREATE TABLE pull_requests (id TEXT PRIMARY KEY, status TEXT); INSERT INTO organizations VALUES (\'fixture\'); INSERT INTO pull_requests VALUES (\'fixture\', \'completed\')');
      const before = await tx.$queryRaw`SELECT * FROM pull_requests`;
      for (const statement of migration.split(";").map(s => s.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
      assert.deepEqual(await tx.$queryRaw`SELECT * FROM pull_requests`, before);
      assert.deepEqual(await tx.$queryRaw`SELECT * FROM review_attempt_outcomes`, []);
      assert.equal((await tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = ${schema}`)[0].n, 3n);
      assert.equal((await tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM information_schema.columns WHERE table_schema = ${schema} AND table_name = 'review_attempt_outcomes' AND column_default IS NOT NULL`)[0].n, 0n);
      await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    });
  } else if (scenario.startsWith("main-")) {
    // Execute the production final-main-comment fragment, not a copy of it.
    const source = await readFile(new URL("../../reviewer.ts", import.meta.url), "utf8");
    const begin = source.indexOf("    outcomeArchiveId = attemptId;", source.indexOf("// The final scored comment"));
    const end = source.indexOf("\n\n    if (promoted", begin); assert.ok(begin > 0 && end > begin);
    const snippet = source.slice(begin, end);
    const js = new Bun.Transpiler({ loader: "ts" }).transformSync(`(async () => { ${snippet} })()`);
    const fn = new Function("outcomeRecord", "coverage", "attemptId", "publishMainComment", "providerUpdateComment", "isGitHub", `let outcomeArchiveId, recordReviewMain = false, reviewCommentId = 1; const mainCommentBody = '', effectiveReviewBody = '', completeReviewAdmission = undefined; return ${js.replace(/;\s*$/, "")};`);
    let calls = 0;
    const post = async () => { calls++; if (scenario === "main-rejected") reject(); if (scenario === "main-unknown") throw new Error("timeout"); if (scenario === "main-stale") return null; return 1; };
    const operation = fn(recorder(), coverage(), archive, post, post, ["main-github", "main-stale", "main-rejected", "main-unknown"].includes(scenario));
    if (["main-rejected", "main-unknown"].includes(scenario)) await assert.rejects(operation); else await operation;
    assert.equal(calls, 1);
    assert.equal((await read()).outcome, scenario === "main-rejected" ? "failed" : scenario === "main-unknown" ? "uncertain" : scenario === "main-stale" ? "superseded" : "published");
  } else if (scenario === "ack-before-db-failure") {
    const r = recorder(); await assert.rejects(r.publish(async () => { r.mainPosted(); throw new Error("database unavailable after acknowledgement"); }));
    assert.equal((await read()).outcome, "published");
  } else if (scenario === "callback-throws" || scenario === "callback-rejects") {
    const requests: string[] = [];
    mock.module("@/lib/github", () => ({
      getInstallationToken: async () => "synthetic-token",
      createPullRequestComment: async () => { requests.push("create"); return 321; },
      updatePullRequestComment: async () => { requests.push("update"); },
      findPullRequestSummaryComment: async () => null,
    }));
    const { publishReviewSummary } = await import("../../review-summary-comment");
    const target = { pullRequestId: pr.id, headSha: pr.headSha, reviewRequestVersion: 1,
      installationId: 1, owner: "fixture", repo: "review", prNumber: 1, body: "Synthetic report" };
    const baseline = await publishReviewSummary(target);
    const baselineSaved = (await prisma.pullRequest.findUniqueOrThrow({ where: { id: pr.id } })).reviewCommentId;
    const baselineRequests = [...requests]; requests.length = 0;
    await prisma.pullRequest.update({ where: { id: pr.id }, data: { reviewCommentId: null } });
    const messages: unknown[][] = [];
    const warning = spyOn(console, "warn").mockImplementation((...args: unknown[]) => { messages.push(args); });
    try {
      const onPosted = scenario === "callback-throws"
        ? () => { throw new Error("Synthetic observer failure"); }
        : async () => { throw new Error("Synthetic observer rejection"); };
      assert.equal(await publishReviewSummary({ ...target, onPosted }), baseline);
      assert.equal((await prisma.pullRequest.findUniqueOrThrow({ where: { id: pr.id } })).reviewCommentId, baselineSaved);
      assert.deepEqual(requests, baselineRequests);
      assert.deepEqual(messages, [["[review-summary] publication observer failed"]]);
    } finally { warning.mockRestore(); }
  } else if (scenario.startsWith("admission")) {
    const source = await readFile(new URL("../../review-request-admission.ts", import.meta.url), "utf8");
    // Keep the admission loop and SQL byte-for-byte identical to the base.
    assert.equal(createHash("sha256").update(source.slice(source.indexOf("async function admitReviewRequestInternal"))).digest("hex"), "03d5b3e10855265f7a35392e99e66082caaf4ba689551fc2a669acb857de6b33");
    assert.ok(!source.includes("$transaction("));
    if (scenario !== "admission-source") {
      const details = async () => ({ headSha: pr.headSha });
      mock.module("@/lib/github", () => ({ getPullRequestDetails: details }));
      mock.module("@/lib/gitlab", () => ({})); mock.module("@/lib/bitbucket", () => ({}));
      mock.module("@/lib/forgejo", () => ({ getPullRequestDetails: details,
        runWithForgejoRepository: async (_id: string, run: () => Promise<unknown>) => run(),
      }));
      await prisma.pullRequest.update({ where: { id: pr.id }, data: { status: "failed" } });
      const { admitReviewRequest } = await import("../../review-request-admission");
      const params = { provider: "github" as const, installationId: 1, organizationId: org.id,
        repoId: repo.id, repoFullName: "fixture/review", prNumber: 1, prTitle: "Synthetic fixture", prUrl: "", prAuthor: "fixture",
        headSha: pr.headSha, triggerCommentId: null, triggerCommentBody: null };
      const until = async (done: () => Promise<boolean>) => {
        for (let i = 0; i < 200; i++) { if (await done()) return; await Bun.sleep(5); }
        assert.fail("Synthetic recording did not settle");
      };
      if (scenario === "admission-failure" || scenario === "admission-slow") {
        let rejectRecording!: (error: Error) => void;
        const blocked = new Promise<never>((_resolve, reject) => { rejectRecording = reject; });
        let warned = false;
        const warning = spyOn(console, "warn").mockImplementation((message: unknown) => {
          assert.equal(message, "[review-outcome] recording unavailable"); warned = true;
        });
        let recordingCalls = 0;
        interceptTransaction = () => {
          recordingCalls++;
          return scenario === "admission-failure" ? Promise.reject(new Error("Synthetic recording failure")) : blocked;
        };
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const result = await Promise.race([admitReviewRequest(params), new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("Admission waited for recording")), 1000);
          })]);
          assert.ok(result.started); assert.equal(result.pullRequest.reviewRequestVersion, 2);
          assert.deepEqual(result.pullRequest, await prisma.pullRequest.findUniqueOrThrow({ where: { id: pr.id } }));
          assert.equal((await read()).outcome, null);
          assert.equal(recordingCalls, 1);
          if (scenario === "admission-slow") { assert.equal(warned, false); rejectRecording(new Error("Synthetic delayed recording failure")); }
          await until(async () => warned);
        } finally { if (timer) clearTimeout(timer); if (scenario === "admission-slow") rejectRecording(new Error("Synthetic cleanup")); interceptTransaction = undefined; warning.mockRestore(); }
      } else if (scenario === "admission-transaction" || scenario === "admission-rollback") {
        const transaction = prisma.$transaction(async tx => {
          const result = await admitReviewRequest({ ...params, provider: "forgejo" }, tx);
          assert.ok(result.started); assert.equal(result.pullRequest.reviewRequestVersion, 2);
          assert.equal((await read()).outcome, null);
          if (scenario === "admission-rollback") throw new Error("Synthetic admission rollback");
          return result;
        });
        if (scenario === "admission-rollback") {
          await assert.rejects(transaction, /Synthetic admission rollback/);
          assert.equal((await prisma.pullRequest.findUniqueOrThrow({ where: { id: pr.id } })).reviewRequestVersion, 1);
          assert.equal((await read()).outcome, null);
        } else {
          await transaction;
          assert.equal((await read()).outcome, null);
          recordReviewAdmissionAfterCommit(pr.id, null);
          await until(async () => (await read()).outcome === "superseded");
        }
      } else {
        const result = await admitReviewRequest(params);
        assert.ok(result.started); assert.equal(result.pullRequest.reviewRequestVersion, 2);
        await until(async () => (await read()).outcome === "superseded");
      }
    }
  } else if (scenario === "claim" || scenario === "large-source") {
    const source = await readFile(new URL(scenario === "claim" ? "../../reviewer.ts" : "../../large-review-result.ts", import.meta.url), "utf8");
    assert.match(source, /await startReviewOutcome\(outcomeKey, new Date\(\)/);
    if (scenario === "claim") {
      assert.match(source, /if \(claimed.count\) await startReviewOutcome/); assert.match(source, /if \(outcomeDeferred\) await deferReviewOutcome/);
      await prisma.reviewAttemptOutcome.deleteMany({ where: { pullRequestId: pr.id } });
      const results = await Promise.all([productionClaim(), productionClaim()]);
      assert.equal(results.reduce((n: number, r: { count: number }) => n + r.count, 0), 1);
      assert.equal((await read()).tries, 1);
    }
    else { assert.match(source, /new ReviewOutcomeRecorder\(outcomeKey, true\)/); assert.match(source, /onPosted: !data.error && recordOutcome \? outcomeRecord.mainPosted/); }
  } else if (scenario === "rejection-classification") {
    for (const prefix of ["PR comment", "GitLab MR note", "Bitbucket PR comment"]) {
      assert.equal(mainCommentFailure(new Error(`Failed to create ${prefix}: 403`)), "failed");
      assert.equal(mainCommentFailure(new Error(`Failed to update ${prefix}: 503`)), "uncertain");
    }
    const forgejo = new Error("HTTP rejection"); Object.assign(forgejo, { status: 422 }); assert.equal(mainCommentFailure(forgejo), "failed");
    assert.equal(mainCommentFailure(new Error("timeout")), "uncertain");
  } else throw new Error("Unknown synthetic scenario");
} finally {
  await prisma.organization.deleteMany({ where: { id: org.id } });
  await prisma.$disconnect();
}
