import "./review-outcome-stub";
import { mock } from "bun:test";
import assert from "node:assert/strict";

type Row = { id: string; pullRequestId: string; reviewBody: string; coverage: unknown; headSha: string | null; baseSha: string | null; createdAt?: Date };
let issues: unknown[] = [];
let duringConfig: (() => void) | undefined;
const rows = new Map<string, Row>();
let current: Record<string, unknown> = {};
let currentHead = "a".repeat(40);
let currentVersion = 1;
let currentUpdatedAt = new Date("2026-09-11T00:00:00Z");
let providerHead = currentHead;
let failArchive = false;
type Delivery = { attemptId: string; mainCommentId: bigint | null; summaryPublished: boolean; completedAt: Date | null; leaseToken: string | null; leaseUntil: Date | null };
const deliveries = new Map<string, Delivery>();
let member = true;
let queries = 0;
mock.module("server-only", () => ({}));
const db = {
  $queryRaw: async () => [{ ...current, headSha: currentHead, reviewRequestVersion: currentVersion, reviewCommentId: current.reviewCommentId ?? null }],
  organization: { findUnique: async () => ({ reviewsPaused: false, blockedAuthors: [] }) },
  reviewAttempt: {
    findMany: async () => [...rows.values()].reverse().slice(0, 5).map(row => ({ id: row.id, headSha: row.headSha, createdAt: row.createdAt ?? new Date("2026-09-11T00:00:00Z") })),
    createMany: async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates: boolean }) => {
      if (failArchive) throw new Error("Archive unavailable");
      let count = 0;
      for (const row of data) {
        if (rows.has(row.id)) {
          if (!skipDuplicates) throw new Error("duplicate attempt");
          continue;
        }
        rows.set(row.id, structuredClone(row)); count++;
      }
      return { count };
    },
    findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
    findFirst: async ({ where }: { where: { id: string; pullRequest?: { repository?: { organization?: { id?: string; members?: { some?: { userId?: string; deletedAt?: unknown } }; bannedAt?: unknown; deletedAt?: unknown }; isActive?: boolean } } } }) => {
      queries++;
      const org = where.pullRequest?.repository?.organization;
      // Emulate row selection: an omitted tenant predicate would expose this
      // row to the foreign caller and make the endpoint regression fail.
      if (org?.id && org.id !== "owner-org") return null;
      if (org?.members && (org.members.some?.userId !== "alice" || !member)) return null;
      return rows.get(where.id) ?? null;
    },
  },
  pullRequest: {
    updateManyAndReturn: async ({ data, where }: { data: Record<string, unknown> & { headSha: string; reviewRequestVersion: { increment: number } }; where: { headSha: string; reviewRequestVersion: number; status: string; updatedAt: Date } }) => {
      if (where.headSha !== currentHead || where.reviewRequestVersion !== currentVersion || where.status !== current.status || where.updatedAt.getTime() !== currentUpdatedAt.getTime()) return [];
      currentVersion += data.reviewRequestVersion.increment;
      currentHead = data.headSha;
      currentUpdatedAt = new Date();
      current = { ...current, ...data, reviewRequestVersion: currentVersion };
      return [{ ...current, id: "pr", headSha: currentHead, reviewRequestVersion: currentVersion, number: 1, createdAt: new Date("2026-09-11T00:00:00Z") }];
    },
    findUnique: async () => ({ ...current, id: "pr", headSha: currentHead, reviewRequestVersion: currentVersion, number: 1, updatedAt: currentUpdatedAt, repository: { id: "repo", provider: "github", fullName: "owner/repo", installationId: 123, organization: { id: "owner-org" } } }),
    updateMany: async ({ data, where }: { data: Record<string, unknown>; where: { headSha?: string; reviewRequestVersion?: number; reviewBody?: string; status?: string; firstReviewCompletedAt?: null } }) => {
      if (where.reviewRequestVersion !== undefined && where.reviewRequestVersion !== currentVersion) return { count: 0 };
      if (where.headSha && where.headSha !== currentHead) return { count: 0 };
      if (where.reviewBody !== undefined && current.reviewBody !== where.reviewBody) return { count: 0 };
      if (where.status !== undefined && current.status !== where.status) return { count: 0 };
      if (where.firstReviewCompletedAt === null && current.firstReviewCompletedAt != null) return { count: 0 };
      current = { ...current, ...structuredClone(data) };
      return { count: 1 };
    },
  },
  reviewAttemptDelivery: {
    createMany: async ({ data }: { data: { attemptId: string }[] }) => {
      for (const row of data) if (!deliveries.has(row.attemptId)) {
        assert.ok(rows.has(row.attemptId), "Delivery requires an archived result");
        deliveries.set(row.attemptId, { ...row, mainCommentId: null, summaryPublished: false, completedAt: null, leaseToken: null, leaseUntil: null });
      }
    },
    findUniqueOrThrow: async ({ where }: { where: { attemptId: string } }) => { const row = deliveries.get(where.attemptId); assert.ok(row); return structuredClone(row); },
    updateMany: async ({ where, data }: { where: { attemptId: string; completedAt?: null; leaseToken?: string; leaseUntil?: { gt: Date }; OR?: { leaseUntil: null | { lte: Date } }[] }; data: Partial<Delivery> }) => {
      const row = deliveries.get(where.attemptId);
      if (!row || (where.completedAt === null && row.completedAt !== null)
        || (where.leaseToken !== undefined && where.leaseToken !== row.leaseToken)
        || (where.leaseUntil && (!row.leaseUntil || row.leaseUntil <= where.leaseUntil.gt))
        || (where.OR && row.leaseUntil && row.leaseUntil > where.OR[1].leaseUntil!.lte)) return { count: 0 };
      Object.assign(row, structuredClone(data));
      if (row.mainCommentId !== null) row.mainCommentId = BigInt(row.mainCommentId);
      return { count: 1 };
    },
  },
  systemConfig: { findUnique: async () => { duringConfig?.(); return null; } },
  reviewIssue: {
    findMany: async () => [],
    deleteMany: async () => { issues = []; },
    createMany: async ({ data }: { data: unknown[] }) => { issues = structuredClone(data); },
  },
};
let transactionTail = Promise.resolve<unknown>(undefined);
let serializeTransactions = false;
mock.module("@octopus/db", () => ({ Prisma: { DbNull: null }, prisma: { ...db,
  $transaction: (run: (tx: typeof db) => Promise<unknown>) => {
    const result = (serializeTransactions ? transactionTail : Promise.resolve()).then(async () => {
    const savedRows = new Map(rows), savedCurrent = structuredClone(current), savedIssues = structuredClone(issues);
    try { return await run(db); }
    catch (error) {
      rows.clear(); for (const [key, value] of savedRows) rows.set(key, value);
      current = savedCurrent; issues = savedIssues;
      throw error;
    }
    });
    transactionTail = result.catch(() => {});
    return result;
  },
} }));
mock.module("@/lib/auth", () => ({ auth: { api: { getSession: async ({ headers }: { headers: Headers }) => headers.get("x-user") ? { user: { id: headers.get("x-user") } } : null } } }));
mock.module("@/lib/api-auth", () => ({ authenticateApiToken: async (request: Request) => {
  const token = request.headers.get("authorization");
  if (token === "Bearer held") return Response.json({ error: "Account held" }, { status: 403 });
  if (token === "Bearer owner") return { org: { id: "owner-org" } };
  if (token === "Bearer foreign") return { org: { id: "other-org" } };
  return null;
} }));

const { saveReviewAttempt, updateCurrentReview, createReviewAttemptComment, recordFirstReviewCompletion } = await import("../../review-attempt");
const { unknownReviewCoverage, prepareReviewInput } = await import("../../review-coverage");
const { GET } = await import("../../../app/api/review-attempts/[id]/route");
const { NextRequest } = await import("next/server");
const { middleware } = await import("../../../middleware");
const first = "11111111-1111-4111-8111-111111111111", second = "22222222-2222-4222-8222-222222222222";
const coverage = { ...unknownReviewCoverage("github", "fixture"), headSha: currentHead, reviewRequestVersion: currentVersion };
await saveReviewAttempt(first, "pr", coverage, "First immutable report");
await saveReviewAttempt(second, "pr", coverage, "Second immutable report");
assert.equal(rows.size, 2);
assert.equal(rows.get(first)?.reviewBody, "First immutable report");
assert.equal(current.reviewBody, "Second immutable report");
await assert.rejects(saveReviewAttempt(first, "pr", coverage, "overwrite"), /identity conflict/);
assert.equal(rows.get(first)?.reviewBody, "First immutable report");
const request = async (headers: Record<string, string>, suffix = "") => {
  const req = new NextRequest("https://example.test/api/review-attempts/" + first + suffix, { headers });
  const routed = middleware(req);
  if (routed.headers.get("x-middleware-next") !== "1") return routed;
  return GET(req, { params: Promise.resolve({ id: first }) });
};
for (const pathname of ["/api/review-attempts-extra/" + first, "/dashboard"]) {
  const response = middleware(new NextRequest("https://example.test" + pathname, { headers: { authorization: "Bearer owner" } }));
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location")!).pathname, "/login");
}
assert.equal((await request({})).status, 401);
assert.equal(queries, 0);
assert.equal((await request({ authorization: "Bearer foreign" })).status, 404);
assert.equal((await request({ authorization: "Bearer invalid", "x-user": "alice" })).status, 401);
assert.equal((await request({ authorization: "Bearer held" })).status, 403);
const authorized = await request({ authorization: "Bearer owner" });
assert.equal(authorized.status, 200);
assert.equal((await authorized.json()).reviewBody, "First immutable report");
assert.equal(authorized.headers.get("cache-control"), "private, no-store");
assert.equal((await request({ "x-user": "bob" })).status, 404);
assert.equal((await request({ "x-user": "alice" })).status, 200);
const beforeNavigation = queries;
const navigation = await request({ accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" });
assert.equal(navigation.status, 307);
assert.equal(navigation.headers.get("location"), `/review-attempts/${first}`);
assert.equal(navigation.headers.get("cache-control"), "private, no-store");
assert.equal(navigation.headers.get("vary"), "Accept");
assert.equal(await navigation.text(), "");
assert.equal(queries, beforeNavigation, "Browser redirect does not fetch private records");
const pageRedirect = middleware(new NextRequest(`https://example.test/review-attempts/${first}`));
assert.equal(new URL(pageRedirect.headers.get("location")!).searchParams.get("callbackUrl"), `/review-attempts/${first}`);
for (const headers of [
  { accept: "text/html;q=0,application/json", "x-user": "alice" },
  { accept: "application/json", "x-user": "alice" },
  { accept: "text/html", authorization: "Bearer owner" },
]) {
  const result = await request(headers);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("content-disposition"), `attachment; filename="review-attempt-${first}.json"`);
  assert.equal((await result.json()).reviewBody, "First immutable report");
}
const download = await request({ accept: "text/html", "x-user": "alice" }, "?download=1");
assert.equal(download.status, 200);
if (process.env.REVIEW_EVIDENCE_DIR) {
  await Bun.write(`${process.env.REVIEW_EVIDENCE_DIR}/downloaded-review.json`, await download.clone().text());
  await Bun.write(`${process.env.REVIEW_EVIDENCE_DIR}/record-http.json`, JSON.stringify({
    boundary: "Actual middleware and GET handler with simulated authentication and in-memory database",
    browserNavigation: { status: navigation.status, headers: Object.fromEntries(navigation.headers) },
    explicitDownload: { status: download.status, headers: Object.fromEntries(download.headers) },
  }, null, 2));
}
assert.equal((await download.json()).reviewBody, "First immutable report");
assert.equal((await request({ accept: "text/html" }, "?download=1")).status, 401);
member = false;
assert.equal((await request({ "x-user": "alice" })).status, 404);
currentHead = "b".repeat(40);
await saveReviewAttempt("33333333-3333-4333-8333-333333333333", "pr", { ...coverage, headSha: "a".repeat(40) }, "Old-head report");
assert.equal(rows.size, 3);
assert.equal(current.reviewBody, "Second immutable report");
await saveReviewAttempt("44444444-4444-4444-8444-444444444444", "pr", { ...coverage, headSha: currentHead }, "New-head report");
await saveReviewAttempt("55555555-5555-4555-8555-555555555555", "pr", unknownReviewCoverage("github", "legacy"), "Unknown-head report");
await saveReviewAttempt("66666666-6666-4666-8666-666666666666", "pr", coverage, "Late old-head report");
assert.equal(rows.size, 6);
assert.equal(current.reviewBody, "New-head report");
assert.equal(rows.get("55555555-5555-4555-8555-555555555555")?.reviewBody, "Unknown-head report");
console.log("PASS stale-head isolation, immutable attempts, token/session tenant isolation, account hold and cache policy");

const checks: unknown[][] = [];
let failCheck = false;
let failSummary = false;
const published: unknown[][] = [];
let allowPublication = false;
let nativeOnlyFailure = false;
let duringPublication: (() => Promise<void>) | undefined;
const unexpectedPublication = () => { throw new Error("Delayed result published to current PR"); };
mock.module("@/lib/github", () => ({
  findPullRequestSummaryComment: async () => null,
  getInstallationToken: async () => "fixture-token",
  getPullRequestDetails: async () => ({ headSha: providerHead }),
  updateCheckRun: async (...args: unknown[]) => { assert.ok([...rows.values()].some(row => (row.coverage as { nativeCheckId?: string }).nativeCheckId === String(args[3])), "Native completion requires a durable archive"); checks.push(args); if (failCheck) throw new Error("Transient check failure"); },
  createPullRequestComment: async (...args: unknown[]) => { if (failSummary && String(args[4]).includes("Large PR —")) throw new Error("Transient summary failure"); if (!allowPublication) unexpectedPublication(); await duringPublication?.(); published.push(args); return 900; },
  updatePullRequestComment: async (...args: unknown[]) => { if (failSummary && String(args[4]).includes("Large PR —")) throw new Error("Transient summary failure"); if (!allowPublication) unexpectedPublication(); await duringPublication?.(); published.push(args); },
  createPullRequestReview: async (...args: unknown[]) => { if (failSummary || nativeOnlyFailure) throw new Error("Transient summary failure"); if (!allowPublication) unexpectedPublication(); published.push(args); return 901; },
}));
mock.module("@/lib/pubby", () => ({ pubby: { trigger: unexpectedPublication } }));
mock.module("@/lib/events", () => ({ eventBus: { emit: unexpectedPublication } }));
const { handleLargeReviewResult } = await import("../../large-review-result");
const origin = { attemptId: "77777777-7777-4777-8777-777777777777", headSha: "a".repeat(40), baseSha: "c".repeat(40), reviewRequestVersion: currentVersion, checkRunId: 17 };
await handleLargeReviewResult(JSON.parse(JSON.stringify({ pullRequestId: "pr", ...origin, reviewBody: "Overall 5/5" })));
assert.equal(checks.length, 1);
assert.equal(checks[0][3], 17);
assert.equal(checks[0][4], "failure");
assert.equal(rows.get(origin.attemptId)?.headSha, origin.headSha);
assert.equal(rows.get(origin.attemptId)?.baseSha, origin.baseSha);
assert.equal((rows.get(origin.attemptId)?.coverage as { nativeCheckId: string }).nativeCheckId, "17");
assert.equal(current.reviewBody, "New-head report");
await handleLargeReviewResult({ pullRequestId: "pr", reviewBody: "Overall 5/5", checkRunId: 99 });
await handleLargeReviewResult({ pullRequestId: "pr", reviewBody: "", error: "legacy error", checkRunId: 99 });
assert.equal(checks.length, 1);
assert.equal(current.reviewBody, "New-head report");
assert.equal([...rows.values()].slice(-2).every(row => row.headSha === null && !(row.coverage as { complete: boolean }).complete), true);
console.log("PASS originating large-review check and revision correlation, legacy result isolation");

const issue = (title: string) => ({ pullRequestId: "pr", title, description: title, severity: "low" });
let finishOldComment!: (id: number) => void;
const oldComment = createReviewAttemptComment("pr", "a".repeat(40), currentVersion, () => new Promise<number>(resolve => { finishOldComment = resolve; }));
const newCommentId = await createReviewAttemptComment("pr", currentHead, currentVersion, async () => 200);
assert.equal(newCommentId, 200);
const newerAttempt = "88888888-8888-4888-8888-888888888888";
assert.equal(await saveReviewAttempt(newerAttempt, "pr", { ...coverage, headSha: currentHead }, "Newer final report", [issue("new finding")]), true);
finishOldComment(100);
assert.equal(await oldComment, 100);
assert.equal(current.reviewCommentId, 200);
assert.deepEqual(await updateCurrentReview("pr", coverage.headSha, coverage.reviewRequestVersion, { status: "failed" }), { count: 0 });
assert.equal(current.status, "completed");
assert.equal(await saveReviewAttempt("99999999-9999-4999-8999-999999999999", "pr", coverage, "Late A report", [issue("old finding")]), false);
assert.deepEqual(issues, [issue("new finding")]);
assert.equal(current.reviewBody, "Newer final report");
assert.equal(rows.get("99999999-9999-4999-8999-999999999999")?.reviewBody, "Late A report");
assert.equal(await saveReviewAttempt("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "pr", unknownReviewCoverage("github", "legacy"), "Unknown report", []), false);
assert.deepEqual(issues, [issue("new finding")]);

currentHead = origin.headSha;
duringConfig = () => { currentHead = "b".repeat(40); };
allowPublication = true;
await handleLargeReviewResult({ pullRequestId: "pr", ...origin, attemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", reviewBody: "Overall 5/5" });
assert.equal(current.reviewCommentId, 200);
assert.equal(current.reviewBody, "Newer final report");
assert.equal(current.status, "completed");
assert.deepEqual(issues, [issue("new finding")]);
assert.equal(published.length, 0);
assert.equal(rows.get("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")?.headSha, origin.headSha);
console.log("PASS publication races preserve current comments, findings and status while archiving stale attempts");

duringConfig = undefined;
mock.module("@/lib/bitbucket", () => ({}));
mock.module("@/lib/gitlab", () => ({}));
mock.module("@/lib/queue", () => ({ enqueue: async () => "queued" }));
const statusEvents: { event: string; data: Record<string, unknown> }[] = [];
mock.module("@/lib/pubby", () => ({ pubby: { trigger: async (_channel: string, event: string, data: Record<string, unknown>) => { statusEvents.push({ event, data }); } } }));
mock.module("@/lib/events", () => ({ eventBus: { emit: () => {} } }));
const { startReviewFlow } = await import("../../webhook-shared");
providerHead = currentHead;
assert.deepEqual(await startReviewFlow({ provider: "github", installationId: 123, repoFullName: "owner/repo", repoId: "repo", orgId: "owner-org", prNumber: 1, prTitle: "Title", prUrl: "https://example.test/pr/1", prAuthor: "author", headSha: currentHead, triggerCommentId: 1, triggerCommentBody: "review" }), { started: true, pullRequestId: "pr" });
assert.equal((statusEvents.at(-1)?.data.pullRequest as { headSha: string }).headSha, currentHead);
assert.equal(published.length, 1);
assert.equal(current.reviewCommentId, 200);
console.log("PASS review triggers reuse the summary while preserving immutable attempts");

const emptyId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const { buildGeneratedMatcher } = await import("../../generated-files");
const emptyInput = prepareReviewInput({ provider: "github", headSha: currentHead, baseSha: origin.baseSha, inventoryComplete: true, expectedFiles: 1, limitations: [], files: [{ path: "bun.lock", change: "modified", patch: "@@ -1 +1 @@\n-old\n+new\n" }] }, { maxChars: 1000, generated: buildGeneratedMatcher() });
assert.equal(emptyInput.diff, "");
assert.equal(emptyInput.coverage.complete, true);
const emptyCoverage = { ...emptyInput.coverage, reviewRequestVersion: currentVersion };
assert.equal(await saveReviewAttempt(emptyId, "pr", emptyCoverage, "No supplied hunks", []), true);
assert.deepEqual(issues, []);
await saveReviewAttempt("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "pr", emptyCoverage, "New current findings", [issue("latest finding")]);
assert.equal(await saveReviewAttempt("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "pr", coverage, "Old empty report", []), false);
assert.deepEqual(issues, [issue("latest finding")]);
assert.equal(current.reviewBody, "New current findings");

const reorderJson = (value: unknown): unknown => Array.isArray(value) ? value.map(reorderJson)
  : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reorderJson(entry)])) : value;
const archivedEmpty = rows.get(emptyId)!;
archivedEmpty.coverage = reorderJson(archivedEmpty.coverage);
const archiveBefore = structuredClone(archivedEmpty);
assert.equal(await saveReviewAttempt(emptyId, "pr", emptyCoverage, "No supplied hunks", []), false);
assert.deepEqual(rows.get(emptyId), archiveBefore);
assert.deepEqual(issues, [issue("latest finding")]);
assert.equal(current.reviewBody, "New current findings");
for (const [prId, candidateCoverage, candidateBody] of [
  ["other-pr", emptyCoverage, "No supplied hunks"],
  ["pr", { ...emptyCoverage, headSha: "f".repeat(40) }, "No supplied hunks"],
  ["pr", { ...emptyCoverage, baseSha: "f".repeat(40) }, "No supplied hunks"],
  ["pr", { ...emptyCoverage, complete: false }, "No supplied hunks"],
  ["pr", { ...emptyCoverage, reviewRequestVersion: currentVersion + 1 }, "No supplied hunks"],
  ["pr", emptyCoverage, "Different body"],
] as const) {
  await assert.rejects(saveReviewAttempt(emptyId, prId, candidateCoverage, candidateBody), /identity conflict/);
  assert.deepEqual(rows.get(emptyId), archiveBefore);
}

const failedJob = { pullRequestId: "pr", ...origin, headSha: currentHead, reviewRequestVersion: currentVersion, attemptId: "ffffffff-ffff-4fff-8fff-ffffffffffff", reviewBody: "", error: "model failure" };
current.firstReviewCompletedAt = null;
allowPublication = false;
await assert.rejects(handleLargeReviewResult(failedJob), /Delayed result published/);
const failureArchive = structuredClone(rows.get(failedJob.attemptId));
assert.ok(failureArchive);
assert.equal(current.status, "completed");
allowPublication = true;
await handleLargeReviewResult(failedJob);
assert.equal(current.status, "failed");
assert.equal(current.firstReviewCompletedAt, null, "Publishing a large-review error is not a completed review");
assert.equal(current.errorMessage, "model failure");
assert.deepEqual(rows.get(failedJob.attemptId), failureArchive);
const publicationCount = published.length;
await handleLargeReviewResult(failedJob);
assert.equal(published.length, publicationCount);

const supersededJob = { ...failedJob, attemptId: "12345678-1234-4234-8234-123456789abc" };
allowPublication = false;
await assert.rejects(handleLargeReviewResult(supersededJob), /Delayed result published/);
const supersededArchive = structuredClone(rows.get(supersededJob.attemptId));
await saveReviewAttempt("23456789-2345-4345-8345-23456789abcd", "pr", emptyCoverage, "New result on same head", [issue("newer result")]);
await createReviewAttemptComment("pr", currentHead, currentVersion, async () => 345);
const newerState = structuredClone(current);
allowPublication = true;
await handleLargeReviewResult(supersededJob);
assert.deepEqual(current, newerState);
assert.deepEqual(issues, [issue("newer result")]);
assert.deepEqual(rows.get(supersededJob.attemptId), supersededArchive);
const beforeConflict = checks.length;
await assert.rejects(handleLargeReviewResult({ ...supersededJob, error: "different error" }), /identity conflict/);
assert.equal(checks.length, beforeConflict);
assert.deepEqual(current, newerState);
console.log("PASS empty finalization, semantic immutable replay, conflicting identity rejection and error recovery");

const racingJob = { ...failedJob, attemptId: "3456789a-3456-4456-8456-3456789abcde" };
allowPublication = false;
await assert.rejects(handleLargeReviewResult(racingJob), /Delayed result published/);
allowPublication = true;
let replacement: Promise<void> | undefined;
serializeTransactions = true;
duringPublication = async () => {
  // A competing writer waits for the publisher's row lock to be released.
  replacement = (async () => {
    await saveReviewAttempt("456789ab-4567-4567-8567-456789abcdef", "pr", emptyCoverage, "Won during publication", [issue("race winner")]);
    await updateCurrentReview("pr", currentHead, currentVersion, { reviewCommentId: 456 });
  })();
};
await handleLargeReviewResult(racingJob);
await replacement;
serializeTransactions = false;
assert.equal(current.status, "completed");
assert.equal(current.reviewBody, "Won during publication");
assert.equal(current.reviewCommentId, 456);
assert.deepEqual(issues, [issue("race winner")]);
duringPublication = undefined;
console.log("PASS resumed error publication cannot change a replacement report on the same head");

const retryJob = { pullRequestId: "pr", ...origin, attemptId: "56789abc-5678-4678-8678-56789abcdef0", reviewBody: "Retry result" };
const beforeRetryState = structuredClone(current);
const beforeRetryRows = rows.size;
failCheck = true;
await assert.rejects(handleLargeReviewResult(retryJob), /Transient check failure/);
assert.equal(rows.size, beforeRetryRows + 1);
assert.ok(rows.get(retryJob.attemptId));
assert.deepEqual(current, beforeRetryState);
failCheck = false;
await handleLargeReviewResult(retryJob);
assert.equal(rows.size, beforeRetryRows + 1);
const archivedRetry = structuredClone(rows.get(retryJob.attemptId));
assert.deepEqual(current, beforeRetryState);
failCheck = true;
await assert.rejects(handleLargeReviewResult(retryJob), /Transient check failure/);
assert.deepEqual(rows.get(retryJob.attemptId), archivedRetry);
failCheck = false;
await handleLargeReviewResult(retryJob);
assert.equal(rows.size, beforeRetryRows + 1);
assert.deepEqual(rows.get(retryJob.attemptId), archivedRetry);
assert.deepEqual(current, beforeRetryState);
assert.deepEqual(checks.slice(-4).map(call => [call[3], call[4]]), Array.from({ length: 4 }, () => [origin.checkRunId, "failure"]));
const archiveFailureJob = { ...retryJob, headSha: currentHead, reviewRequestVersion: currentVersion, attemptId: "12121212-1212-4212-8212-121212121212" };
const beforeArchiveFailure = { checks: checks.length, comments: published.length, current: structuredClone(current) };
failArchive = true;
await assert.rejects(handleLargeReviewResult(archiveFailureJob), /Archive unavailable/);
failArchive = false;
assert.equal(rows.has(archiveFailureJob.attemptId), false);
assert.equal(checks.length, beforeArchiveFailure.checks);
assert.equal(published.length, beforeArchiveFailure.comments);
assert.deepEqual(current, beforeArchiveFailure.current);

const interruptedSuccess = { ...archiveFailureJob, attemptId: "13131313-1313-4313-8313-131313131313" };
current.firstReviewCompletedAt = null;
failCheck = true;
await assert.rejects(handleLargeReviewResult(interruptedSuccess), /Transient check failure/);
const savedSuccess = structuredClone(rows.get(interruptedSuccess.attemptId));
assert.ok(savedSuccess);
assert.equal(current.firstReviewCompletedAt, null, "An archived result with a failed check is not successful delivery");
assert.equal(published.length, beforeArchiveFailure.comments);
failCheck = false;
allowPublication = false;
await assert.rejects(handleLargeReviewResult(interruptedSuccess), /Delayed result published/);
assert.equal(deliveries.get(interruptedSuccess.attemptId)?.leaseToken, null);
assert.equal(deliveries.get(interruptedSuccess.attemptId)?.completedAt, null);
assert.equal(current.firstReviewCompletedAt, null, "A failed main-comment publication is not successful delivery");
allowPublication = true;
failSummary = true;
const summaryErrors: unknown[][] = [];
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => { summaryErrors.push(args); };
try { await assert.rejects(handleLargeReviewResult(interruptedSuccess), /Transient summary failure/); }
finally { console.error = originalConsoleError; }
assert.equal(summaryErrors.length, 1);
assert.match(String(summaryErrors[0][1]), /Transient summary failure/);
assert.equal(published.length, beforeArchiveFailure.comments + 1);
assert.equal(deliveries.get(interruptedSuccess.attemptId)?.mainCommentId, 456n);
assert.equal(deliveries.get(interruptedSuccess.attemptId)?.summaryPublished, false);
assert.equal(current.firstReviewCompletedAt, null, "The main comment alone cannot complete the large-review workflow");
failSummary = false;
await handleLargeReviewResult(interruptedSuccess);
assert.equal(published.length, beforeArchiveFailure.comments + 2);
assert.ok(deliveries.get(interruptedSuccess.attemptId)?.completedAt);
assert.ok(current.firstReviewCompletedAt instanceof Date, "Successful large-review publication records its first completion");
const firstCompletionAt = (current.firstReviewCompletedAt as Date).getTime();
assert.deepEqual(rows.get(interruptedSuccess.attemptId), savedSuccess);
assert.equal((current.firstReviewCompletedAt as Date).getTime(), firstCompletionAt);
await updateCurrentReview("pr", currentHead, currentVersion, { status: "failed" });
assert.equal((current.firstReviewCompletedAt as Date).getTime(), firstCompletionAt, "Later failures retain the first successful review");
await updateCurrentReview("pr", currentHead, currentVersion, { status: "completed" });
await recordFirstReviewCompletion("pr", currentHead, currentVersion, String(current.reviewBody));
assert.equal((current.firstReviewCompletedAt as Date).getTime(), firstCompletionAt, "Later success cannot replace the first timestamp");

current.firstReviewCompletedAt = null;
await recordFirstReviewCompletion("pr", "stale-head", currentVersion, String(current.reviewBody));
await recordFirstReviewCompletion("pr", currentHead, currentVersion - 1, String(current.reviewBody));
await recordFirstReviewCompletion("pr", currentHead, currentVersion, "superseded report");
assert.equal(current.firstReviewCompletedAt, null, "Stale head, request and report cannot mark a replacement request complete");
current.firstReviewCompletedAt = new Date(firstCompletionAt);
await handleLargeReviewResult(interruptedSuccess);
assert.equal(published.length, beforeArchiveFailure.comments + 2);
assert.deepEqual(rows.get(interruptedSuccess.attemptId), savedSuccess);

const concurrentDelivery = { ...archiveFailureJob, attemptId: "14141414-1414-4414-8414-141414141414" };
let releaseDelivery!: () => void;
let reachedDelivery!: () => void;
const publishing = new Promise<void>(resolve => { reachedDelivery = resolve; });
duringPublication = async () => { reachedDelivery(); await new Promise<void>(resolve => { releaseDelivery = resolve; }); };
const firstDelivery = handleLargeReviewResult(concurrentDelivery);
await publishing;
const concurrentArchive = structuredClone(rows.get(concurrentDelivery.attemptId));
await assert.rejects(handleLargeReviewResult(concurrentDelivery), /delivery is already in progress/);
releaseDelivery();
await firstDelivery;
duringPublication = undefined;
assert.deepEqual(rows.get(concurrentDelivery.attemptId), concurrentArchive);
assert.ok(deliveries.get(concurrentDelivery.attemptId)?.completedAt);

const abandonedDelivery = { ...archiveFailureJob, attemptId: "15151515-1515-4515-8515-151515151515" };
allowPublication = false;
await assert.rejects(handleLargeReviewResult(abandonedDelivery), /Delayed result published/);
const abandoned = deliveries.get(abandonedDelivery.attemptId)!;
abandoned.leaseToken = "dead-worker";
abandoned.leaseUntil = new Date(Date.now() - 1);
allowPublication = true;
await handleLargeReviewResult(abandonedDelivery);
assert.ok(deliveries.get(abandonedDelivery.attemptId)?.completedAt);
console.log("PASS archive-before-effects, success publication/check retries, delivery checkpoints and concurrent/abandoned lease recovery");

const currentJob = { ...retryJob, headSha: currentHead, reviewRequestVersion: currentVersion, attemptId: "6789abcd-6789-4789-8789-6789abcdef01" };
await handleLargeReviewResult(currentJob);
assert.equal(statusEvents.at(-1)?.event, "review-status");
assert.equal(statusEvents.at(-1)?.data.headSha, currentHead);
assert.equal(statusEvents.at(-1)?.data.status, "completed");
console.log("PASS native-check retry before redelivery return, stable archives and revision-bearing status events");

const { applyReviewRequested, applyReviewStatus } = await import("../../review-status-state");
let releaseA!: () => void;
let reachedA!: () => void;
const aAtPublication = new Promise<void>(resolve => { reachedA = resolve; });
let firstPublication = true;
duringPublication = async () => {
  if (!firstPublication) return;
  firstPublication = false;
  reachedA();
  await new Promise<void>(resolve => { releaseA = resolve; });
};
const requestArgs = { provider: "github" as const, installationId: 123, repoFullName: "owner/repo", repoId: "repo", orgId: "owner-org", prNumber: 1, prTitle: "Title", prUrl: "https://example.test/pr/1", prAuthor: "author", triggerCommentId: 1, triggerCommentBody: "review" };
const eventStart = statusEvents.length;
providerHead = "a".repeat(40);
const requestA = startReviewFlow({ ...requestArgs, headSha: "a".repeat(40) });
await aAtPublication;
const versionA = currentVersion;
providerHead = "b".repeat(40);
await startReviewFlow({ ...requestArgs, headSha: "b".repeat(40) });
const versionB = currentVersion;
assert.equal(versionB, versionA + 1);
await handleLargeReviewResult({ ...currentJob, attemptId: "789abcde-789a-489a-889a-789abcdef012", headSha: currentHead, reviewRequestVersion: versionB });
const completedB = structuredClone(current);
releaseA();
await requestA;
duringPublication = undefined;
assert.deepEqual(current, completedB);
let dashboard: Record<string, import("../../review-status-state").ReviewState[]> = {};
for (const event of statusEvents.slice(eventStart)) {
  if (event.event === "review-requested") dashboard = applyReviewRequested(dashboard, event.data as Parameters<typeof applyReviewRequested>[1]);
  if (event.event === "review-status") dashboard = applyReviewStatus(dashboard, event.data as Parameters<typeof applyReviewStatus>[1]);
}
assert.equal(dashboard.repo[0].reviewRequestVersion, versionB);
assert.equal(dashboard.repo[0].status, "completed");
assert.equal(applyReviewStatus(dashboard, { repoId: "repo", pullRequestId: "pr", number: 1, status: "completed", headSha: "a".repeat(40), reviewRequestVersion: versionA }), dashboard);
const oldSameHeadCoverage = { ...emptyCoverage, headSha: currentHead, reviewRequestVersion: versionA };
assert.equal(await saveReviewAttempt("89abcdef-89ab-49ab-89ab-89abcdef0123", "pr", oldSameHeadCoverage, "Old same-head version", []), false);
assert.deepEqual(current, completedB);
const legacyOrderJob = { ...currentJob, attemptId: "9abcdef0-9abc-4abc-8abc-9abcdef01234", headSha: currentHead, reviewRequestVersion: undefined };
await handleLargeReviewResult(legacyOrderJob);
assert.deepEqual(current, completedB);
assert.equal((rows.get(legacyOrderJob.attemptId)?.coverage as { reviewRequestVersion?: number }).reviewRequestVersion, undefined);
console.log("PASS persisted A/B request ordering, same-head ownership and unknown-order worker isolation");

await startReviewFlow({ ...requestArgs, headSha: currentHead });
assert.equal(currentVersion, versionB + 1);
const sameHeadRequested = structuredClone(current);
const lateSameHeadJob = { ...currentJob, attemptId: "abcdef01-abcd-4bcd-8bcd-abcdef012345", headSha: currentHead, reviewRequestVersion: versionB };
await handleLargeReviewResult(lateSameHeadJob);
assert.deepEqual(current, sameHeadRequested);
assert.equal((rows.get(lateSameHeadJob.attemptId)?.coverage as { reviewRequestVersion: number }).reviewRequestVersion, versionB);
console.log("PASS persisted same-head re-request rejects prior-version worker promotion");

const { fetchGitHubReviewInput } = await import("../../github-review-input");
const binaryBlob = "c".repeat(40), binaryBase = "2".repeat(40);
const binaryInput = await fetchGitHubReviewInput({
  expectedHead: currentHead, maxPatchChars: 1000,
  fetchDiff: async () => "diff --git a/docs/example.png b/docs/example.png\nnew file mode 100644\nindex 0000000..ccccccc\nBinary files /dev/null and b/docs/example.png differ\n",
  readJson: async suffix => suffix
    ? [{ filename: "docs/example.png", status: "added", additions: 0, deletions: 0, sha: binaryBlob }]
    : { head: { sha: currentHead }, base: { sha: binaryBase }, changed_files: 1 },
});
const binaryCoverage = prepareReviewInput(binaryInput.input, { maxChars: 1000 }).coverage;
binaryCoverage.reviewRequestVersion = currentVersion;
assert.equal(binaryCoverage.files[0].state, "excluded");
assert.ok(binaryCoverage.files[0].binaryEvidence);
const binaryAttempt = "bacdef01-abcd-4bcd-8bcd-abcdef012345";
await saveReviewAttempt(binaryAttempt, "pr", binaryCoverage, "Binary asset not reviewed");
const binaryDownload = await GET(new NextRequest("https://example.test/api/review-attempts/" + binaryAttempt, { headers: { authorization: "Bearer owner" } }), { params: Promise.resolve({ id: binaryAttempt }) });
assert.equal(binaryDownload.status, 200);
assert.deepEqual((await binaryDownload.json()).coverage, JSON.parse(JSON.stringify(binaryCoverage)));
const alteredBinaryCoverage = structuredClone(binaryCoverage);
alteredBinaryCoverage.files[0].binaryEvidence!.rawSectionSha256 = "0".repeat(64);
await assert.rejects(saveReviewAttempt(binaryAttempt, "pr", alteredBinaryCoverage, "Binary asset not reviewed"), /identity conflict/);
assert.deepEqual(rows.get(binaryAttempt)?.coverage, JSON.parse(JSON.stringify(binaryCoverage)));
console.log("PASS binary evidence survives immutable archive/download and cannot be overwritten");

if (process.env.REVIEW_TEST_EVIDENCE_DIR) {
  const download = await request({ authorization: "Bearer owner" });
  await Bun.write(`${process.env.REVIEW_TEST_EVIDENCE_DIR}/attempt-contract.json`, JSON.stringify({
    boundary: "Actual request, result and HTTP handlers; mocked database, authentication and provider services",
    download: { status: download.status, headers: Object.fromEntries(download.headers), body: await download.json() },
    deliveredEvents: statusEvents.slice(eventStart), dashboardAfterDelayedRequest: dashboard,
    persistedCurrent: current, originatingCheckUpdates: checks.slice(-4),
    immutableAttempts: [...rows.values()],
  }, null, 2));
}

const fallbackJob = { ...archiveFailureJob, headSha: currentHead, reviewRequestVersion: currentVersion, attemptId: "19191919-1919-4919-8919-191919191919" };
allowPublication = true;
duringPublication = undefined;
nativeOnlyFailure = true;
const beforeFallback = published.length;
console.error = () => {};
try { await handleLargeReviewResult(fallbackJob); } finally { console.error = originalConsoleError; }
const fallbackCalls = published.slice(beforeFallback);
assert.equal(fallbackCalls.length, 2);
assert.ok(fallbackCalls.every(call => call[3] === Number(current.reviewCommentId)), "Fallback must update the tracked comment");
assert.ok(String(fallbackCalls[1][4]).includes("Large PR —"));
assert.ok(String(fallbackCalls[1][4]).includes("Review coverage"));
assert.ok(String(fallbackCalls[1][4]).endsWith(`Last reviewed commit: ${currentHead}`));
assert.ok(deliveries.get(fallbackJob.attemptId)?.summaryPublished);
