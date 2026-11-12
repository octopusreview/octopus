import { mock } from "bun:test";
import assert from "node:assert/strict";

mock.module("server-only", () => ({}));
const head = "a".repeat(40), nextHead = "b".repeat(40);
let current = { headSha: head, reviewRequestVersion: 1, reviewCommentId: null as bigint | null, reviewBody: null as string | null, status: "pending" };
const archived = [{ id: "11111111-2222-4333-8444-555555555555", headSha: head, createdAt: new Date("2026-09-11T12:00:00Z"), reviewBody: "Original immutable report" }];
const before = structuredClone(archived);
let exists = true;
let duringAuth: (() => Promise<void>) | undefined;
let duringLock: (() => Promise<void>) | undefined;
const tx = {
  $queryRaw: async (_sql: TemplateStringsArray, id: string) => { assert.equal(id, "pr"); await duringLock?.(); return exists ? [{ ...current }] : []; },
  reviewAttempt: { findMany: async (query: { where: { pullRequestId: string }; take: number; select: Record<string, boolean> }) => {
    assert.equal(query.where.pullRequestId, "pr");
    assert.ok(query.take <= 10, "Publication must not load an unbounded history");
    assert.equal(query.select.reviewBody, undefined);
    return archived.map(({ id, headSha, createdAt }) => ({ id, headSha, createdAt }));
  } },
  pullRequest: { updateMany: async ({ data, where }: { data: { reviewCommentId: number | null }; where: { reviewCommentId?: number } }) => {
    if (where.reviewCommentId !== undefined && current.reviewCommentId !== BigInt(where.reviewCommentId)) return { count: 0 };
    current.reviewCommentId = data.reviewCommentId === null ? null : BigInt(data.reviewCommentId);
    return { count: 1 };
  } },
};
// The test double models the exclusive row lock: concurrent publications and
// admission serialize. The provider side effects below are the assertions.
let tail = Promise.resolve();
function transaction<T>(run: (client: typeof tx) => Promise<T>): Promise<T> {
  const result = tail.then(async () => {
    const snapshot = { ...current };
    try {
      const result = await run(tx);
      if (supersedeReservation && current.reviewCommentId !== null && current.reviewCommentId < 0n) {
        supersedeReservation = false;
        current.reviewRequestVersion++;
      }
      return result;
    } catch (error) { current = snapshot; throw error; }
  });
  tail = result.then(() => {}, () => {});
  return result;
}
mock.module("@octopus/db", () => ({ prisma: { $transaction: transaction } }));
const calls: { method: string; id: number; body: string }[] = [];
let nextId = 100;
let failure = "";
let createFailure = false;
let rejection = "";
let supersedeReservation = false;
const remote = new Map<string, number>();
let beforeUpdate: (() => Promise<void>) | undefined;
mock.module("@/lib/github", () => ({
  findPullRequestSummaryComment: async (_owner: string, _repo: string, _number: number, marker: string) => remote.get(marker) ?? null,
  getInstallationToken: async () => { await duringAuth?.(); return "fixture-token"; },
  createPullRequestComment: async (_installation: number, _owner: string, _repo: string, _number: number, body: string, _token: string, signal: AbortSignal, marker: string) => {
    assert.equal(signal.aborted, false);
    if (rejection) throw new Error(rejection);
    const id = nextId++;
    calls.push({ method: "POST", id, body });
    remote.set(marker, id);
    if (createFailure) throw new Error("Response lost");
    return id;
  },
  updatePullRequestComment: async (_installation: number, _owner: string, _repo: string, id: number, body: string, _token: string, signal: AbortSignal) => {
    assert.equal(signal.aborted, false);
    if (failure) throw new Error(failure);
    await beforeUpdate?.();
    calls.push({ method: "PATCH", id, body });
  },
}));
const { publishReviewSummary } = await import("../../review-summary-comment");
const target = { pullRequestId: "pr", headSha: head, reviewRequestVersion: 1, installationId: 1, owner: "fixture", repo: "repo", prNumber: 1, body: "Queued" };

const concurrent = await Promise.all([publishReviewSummary(target), publishReviewSummary({ ...target, body: "Preparing" })]);
assert.deepEqual(concurrent, [100, 100]);
assert.ok(calls.at(-1)?.body.startsWith("Preparing"));
assert.equal(calls.filter(call => call.method === "POST").length, 1);
assert.equal(current.reviewCommentId, 100n);
current = { ...current, headSha: nextHead, reviewRequestVersion: 2, status: "reviewing" };
const newer = { ...target, headSha: nextHead, reviewRequestVersion: 2 };
await publishReviewSummary({ ...newer, body: "Review in progress" });
assert.equal(calls.at(-1)?.id, 100);
assert.equal(calls.at(-1)?.body, `Review in progress\n\nReview history: https://octopus-review.ai/review-attempts/${archived[0].id}`);
assert.deepEqual(archived, before);
const count = calls.length;
assert.equal(await publishReviewSummary(target), null);
assert.equal(await publishReviewSummary({ ...newer, reviewRequestVersion: 1 }), null);
assert.equal(await publishReviewSummary({ ...newer, expectedReviewBody: "Wrong result" }), null);
assert.equal(calls.length, count);

current.status = "completed";
current.reviewBody = "Durable result";
assert.equal(await publishReviewSummary(newer), null); // late progress cannot erase completion
await publishReviewSummary({ ...newer, body: `Final result\n\nLast reviewed commit: ${nextHead}`, expectedReviewBody: "Durable result" });
assert.ok(calls.at(-1)?.body.endsWith(`Last reviewed commit: ${nextHead}`));
assert.equal(calls.at(-1)?.id, 100);
for (const message of ["Failed to update PR comment: 403", "Failed to update PR comment: 503", "Network timeout"]) {
  failure = message;
  await assert.rejects(publishReviewSummary({ ...newer, expectedReviewBody: "Durable result" }), { message });
  assert.equal(nextId, 101);
  assert.equal(current.reviewCommentId, 100n);
}
failure = "Failed to update PR comment: 404";
await publishReviewSummary({ ...newer, expectedReviewBody: "Durable result" });
assert.equal(current.reviewCommentId, 101n);
failure = "";
await publishReviewSummary({ ...newer, expectedReviewBody: "Durable result" });
assert.deepEqual([calls.at(-1)?.method, calls.at(-1)?.id], ["PATCH", 101]);

current.status = "reviewing";
let release!: () => void, started!: () => void;
const gate = new Promise<void>(resolve => { release = resolve; });
const entered = new Promise<void>(resolve => { started = resolve; });
beforeUpdate = async () => { started(); await gate; };
const oldPublication = publishReviewSummary({ ...newer, body: "Old progress" });
await entered;
const admission = transaction(async () => { current.reviewRequestVersion = 3; current.status = "reviewing"; });
const latestPublication = publishReviewSummary({ ...newer, reviewRequestVersion: 3, body: "Newest progress" });
release();
await Promise.all([oldPublication, admission, latestPublication]);
beforeUpdate = undefined;
assert.ok(calls.at(-1)?.body.startsWith("Newest progress"));
const finalCount = calls.length;
assert.equal(await publishReviewSummary(newer), null);
current.reviewCommentId = null;
createFailure = true;
const recoveryTarget = { ...newer, reviewRequestVersion: 3 };
await assert.rejects(publishReviewSummary(recoveryTarget), /Response lost/);
assert.ok(current.reviewCommentId! < 0n);
const posts = calls.filter(call => call.method === "POST").length;
createFailure = false;
await publishReviewSummary(recoveryTarget);
assert.equal(current.reviewCommentId, BigInt(nextId - 1));
assert.equal(calls.filter(call => call.method === "POST").length, posts);
// A publisher that stopped after reserving, before any comment existed, no longer blocks the PR.
current.reviewCommentId = -42n;
const adopted = await publishReviewSummary(recoveryTarget);
assert.equal(calls.filter(call => call.method === "POST").length, posts + 1);
assert.equal(adopted, nextId - 1);
assert.equal(remote.get("Octopus publication reference: pr:42"), adopted);
assert.equal(current.reviewCommentId, BigInt(adopted!));
current.status = "completed";
current.reviewBody = "Archived failure";
await publishReviewSummary({ ...recoveryTarget, body: "Archived failure", expectedReviewBody: "Archived failure" });
assert.ok(calls.at(-1)?.body.startsWith("Archived failure"));
current.status = "reviewing";
current.reviewCommentId = null;
for (const status of [401, 403, 422, 429]) {
  rejection = `Failed to create PR comment: ${status}`;
  await assert.rejects(publishReviewSummary(recoveryTarget), { message: rejection });
  assert.equal(current.reviewCommentId, null);
}
rejection = "Failed to create PR comment: 503";
await assert.rejects(publishReviewSummary(recoveryTarget), /503/);
const uncertainReservation = current.reviewCommentId;
assert.ok(uncertainReservation! < 0n);
// The uncertain creation left no comment: the retry posts exactly once under the same reservation.
rejection = "";
const postsBeforeRetry = calls.filter(call => call.method === "POST").length;
assert.ok((await publishReviewSummary(recoveryTarget))! > 0);
assert.equal(calls.filter(call => call.method === "POST").length, postsBeforeRetry + 1);
assert.equal(remote.get(`Octopus publication reference: pr:${-uncertainReservation!}`), Number(current.reviewCommentId));
assert.ok(current.reviewCommentId! > 0n);
// A fresh PR can create normally after confirmed rejections.
current.reviewCommentId = null;
rejection = "";
await publishReviewSummary(recoveryTarget);
assert.ok(current.reviewCommentId! > 0n);
current.reviewCommentId = null;
supersedeReservation = true;
const beforeSupersession = nextId;
assert.equal(await publishReviewSummary(recoveryTarget), null);
assert.equal(current.reviewCommentId, null);
assert.equal(nextId, beforeSupersession);
await publishReviewSummary({ ...recoveryTarget, reviewRequestVersion: current.reviewRequestVersion });
assert.ok(current.reviewCommentId! > 0n);
exists = false;
assert.equal(await publishReviewSummary({ ...newer, reviewRequestVersion: 3 }), null);
assert.ok(calls.length >= finalCount);
assert.deepEqual(archived, before);
console.log("PASS stable summary, history, stale fencing, concurrency and failure handling");

for (const stage of ["auth", "lock"]) {
  exists = true;
  current = { ...current, headSha: head, reviewRequestVersion: 1, status: "completed", reviewBody: "Scored", reviewCommentId: 100n };
  const controller = new AbortController();
  const cancel = async () => { await Promise.resolve(); controller.abort(); };
  duringAuth = stage === "auth" ? cancel : undefined;
  duringLock = stage === "lock" ? cancel : undefined;
  const countBefore = calls.length;
  await assert.rejects(publishReviewSummary({ ...target, body: "Score 5/5", expectedReviewBody: "Scored",
    executionWindow: { jobId: "job", signal: controller.signal, deadlineEpochMs: Date.now() + 10000, remainingMs: () => 10000 } }));
  assert.equal(calls.length, countBefore);
  duringAuth = undefined; duringLock = undefined;
  await publishReviewSummary({ ...target, body: "Unscored failure", expectedReviewBody: "Scored" });
  assert.equal(calls.length, countBefore + 1);
}
