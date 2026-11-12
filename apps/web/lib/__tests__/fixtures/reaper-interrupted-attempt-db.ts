import { mock } from "bun:test";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
assert.match(url.pathname, /(^|[-_])test($|[-_])/);
assert.equal(url.search, "");
assert.equal(url.hash, "");
url.hostname = "127.0.0.1";
process.env.DATABASE_URL = url.toString();
mock.module("server-only", () => ({}));
const { prisma } = await import("@octopus/db");
const id = randomUUID();
const org = await prisma.organization.create({ data: { name: "Synthetic", slug: `reaper-attempt-test-${id}` } });
const enqueued: string[] = [];
try {
  const repo = await prisma.repository.create({ data: { organizationId: org.id, name: "Synthetic", fullName: "fixture/repo", externalId: id } });
  const now = new Date();
  const stale = new Date(now.getTime() - 45 * 60_000);
  const head = "a".repeat(40);
  const create = (number: number, status: string, reviewAttemptId: string | null) => prisma.pullRequest.create({
    data: { repositoryId: repo.id, number, title: "Synthetic", url: "", author: "fixture", status, headSha: head, reviewRequestVersion: 1, reviewAttemptId, updatedAt: stale },
  });
  const outcome = (pullRequestId: string, generationAttempts: number) => prisma.reviewAttemptOutcome.create({
    data: { organizationId: org.id, repositoryId: repo.id, pullRequestId, requestVersion: 1, kind: "not_assessed", tries: 1, firstTriedAt: stale, generationAttempts },
  });
  // Stopped while a generation was in flight, stopped before any generation, generated and charged,
  // a queued large review, and a claim made before attempt IDs were stored.
  const dispatched = await create(1, "reviewing", randomUUID());
  const undispatched = await create(2, "reviewing", randomUUID());
  const charged = await create(3, "reviewing", randomUUID());
  const queued = await create(4, "queued", randomUUID());
  const earlier = await create(5, "reviewing", null);
  await outcome(dispatched.id, 1);
  await outcome(undispatched.id, 0);
  await outcome(charged.id, 1);
  await prisma.aiUsage.create({ data: { provider: "mock", model: "fixture", operation: "review", inputTokens: 1, outputTokens: 1,
    organizationId: org.id, chargeKey: `review-generation:${charged.id}:1:${head}` } });

  mock.module("@/lib/queue", () => ({
    enqueue: async (_name: string, payload: { pullRequestId: string }) => { enqueued.push(payload.pullRequestId); return "synthetic"; },
    loadQueueConfig: async () => ({ reviewTimeoutSeconds: 900, largeReviewTimeoutSeconds: 1800, reviewConcurrency: 2 }),
    computeStaleReclaimMs: (s: number) => (s + 300) * 1000,
  }));
  const { reapStuckReviews } = await import("@/lib/reap-stuck-reviews");
  const { recordInterruptedAttempt } = await import("@/lib/review-attempt");
  const transaction = prisma.$transaction.bind(prisma);
  prisma.$transaction = ((work: (tx: unknown) => Promise<unknown>) => transaction(async tx => work(new Proxy(tx, {
    get(target, key) {
      if (key === "reviewAttempt") return { createMany: async () => { throw new Error("receipt insert failed"); } };
      return Reflect.get(target, key);
    },
  })))) as typeof prisma.$transaction;
  try {
    await assert.rejects(reapStuckReviews(now), /receipt insert failed/);
  } finally {
    prisma.$transaction = transaction as typeof prisma.$transaction;
  }
  for (const pr of [dispatched, undispatched, charged]) {
    assert.equal((await prisma.pullRequest.findUniqueOrThrow({ where: { id: pr.id } })).status, "reviewing");
  }
  // Two reapers at once: each orphan is failed, requeued and recorded exactly once.
  await Promise.all([reapStuckReviews(now), reapStuckReviews(now)]);
  const mine = [dispatched.id, undispatched.id, charged.id, queued.id, earlier.id];
  const requeued = () => enqueued.filter(pullRequestId => mine.includes(pullRequestId)).sort();
  assert.deepEqual(requeued(), [...mine].sort());

  const attempts = await prisma.reviewAttempt.findMany({ where: { pullRequest: { repositoryId: repo.id } } });
  const limitations = (pr: { reviewAttemptId: string | null }) => {
    const rows = attempts.filter(attempt => attempt.id === pr.reviewAttemptId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].headSha, head);
    assert.equal((rows[0].coverage as { reviewRequestVersion: number }).reviewRequestVersion, 1);
    assert.ok(rows[0].reviewBody.includes("Worker stopped before this attempt was recorded"));
    return (rows[0].coverage as { limitations: string[] }).limitations;
  };
  assert.deepEqual(limitations(dispatched), ["Worker stopped before this attempt was recorded", "provider dispatch outcome unknown"]);
  assert.deepEqual(limitations(undispatched), ["Worker stopped before this attempt was recorded"]);
  assert.deepEqual(limitations(charged), ["Worker stopped before this attempt was recorded"]);
  assert.equal(attempts.length, 3, "a queued large review and a claim without an attempt ID record nothing");
  for (const pr of await prisma.pullRequest.findMany({ where: { repositoryId: repo.id } })) {
    assert.equal(pr.status, "failed");
    assert.equal(pr.reviewBody, null, "the record is not promoted to the current report");
  }

  // A second reap, and a repeated record for the same attempt, add nothing and change nothing.
  await reapStuckReviews(now);
  assert.equal(requeued().length, mine.length);
  await prisma.aiUsage.deleteMany({ where: { organizationId: org.id } });
  await recordInterruptedAttempt({ ...charged, repository: { provider: "github" } });
  assert.deepEqual(await prisma.reviewAttempt.findMany({ where: { pullRequest: { repositoryId: repo.id } }, orderBy: { id: "asc" } }),
    [...attempts].sort((a, b) => a.id.localeCompare(b.id)));
  console.log("PASS interrupted attempts are recorded once under their own ID");
} finally {
  await prisma.reviewAttemptOutcome.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.$disconnect();
}
