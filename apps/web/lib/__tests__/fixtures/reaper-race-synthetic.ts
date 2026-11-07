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
const { prisma: actual } = await import("@octopus/db");
const id = randomUUID();
const org = await actual.organization.create({ data: { name: "Synthetic", slug: `reaper-test-${id}` } });
const enqueued: string[] = [];
try {
  const repo = await actual.repository.create({ data: { organizationId: org.id, name: "Synthetic", fullName: "fixture/repo", externalId: id } });
  const now = new Date();
  const stale = new Date(now.getTime() - 45 * 60_000);
  const create = (number: number, status: string, updatedAt = stale, createdAt = now) => actual.pullRequest.create({
    data: { repositoryId: repo.id, number, title: "Synthetic", url: "", author: "fixture", status, reviewRequestVersion: 1, updatedAt, createdAt },
  });
  const freshReview = await create(1, "reviewing");
  const replacedQueue = await create(2, "queued");
  const changedStatus = await create(3, "reviewing");
  const oldReview = await create(4, "reviewing");
  const oldQueue = await create(5, "queued");
  const withinQueueWindow = await create(6, "queued", new Date(now.getTime() - 25 * 60_000));
  const backlog = await create(7, "reviewing", stale, new Date(now.getTime() - 7 * 60 * 60_000));

  const pullRequest = new Proxy(actual.pullRequest, { get(target, key, receiver) {
    if (key !== "findMany") return Reflect.get(target, key, receiver);
    return async (args: Parameters<typeof actual.pullRequest.findMany>[0]) => {
      const rows = await actual.pullRequest.findMany({ ...args, where: { AND: [args?.where ?? {}, { repositoryId: repo.id }] } });
      assert.ok(rows.some(row => row.id === freshReview.id));
      await actual.pullRequest.update({ where: { id: freshReview.id }, data: { updatedAt: now } });
      await actual.pullRequest.update({ where: { id: replacedQueue.id }, data: { reviewRequestVersion: 2, updatedAt: stale } });
      await actual.pullRequest.update({ where: { id: changedStatus.id }, data: { status: "queued", updatedAt: now } });
      return rows;
    };
  } });
  const wrapped = new Proxy(actual, { get(target, key, receiver) { return key === "pullRequest" ? pullRequest : Reflect.get(target, key, receiver); } });
  mock.module("@octopus/db", () => ({ prisma: wrapped }));
  mock.module("@/lib/queue", () => ({
    enqueue: async (_name: string, payload: { pullRequestId: string }) => { enqueued.push(payload.pullRequestId); return "synthetic"; },
    loadQueueConfig: async () => ({ reviewTimeoutSeconds: 900, largeReviewTimeoutSeconds: 1800, reviewConcurrency: 2 }),
    computeStaleReclaimMs: (s: number) => (s + 300) * 1000,
  }));
  const { reapStuckReviews } = await import("@/lib/reap-stuck-reviews");
  assert.deepEqual(await reapStuckReviews(now), { requeued: 2, failed: 1 });
  const rows = await actual.pullRequest.findMany({ where: { repositoryId: repo.id } });
  const status = (pr: { id: string }) => rows.find(row => row.id === pr.id)?.status;
  assert.equal(status(freshReview), "reviewing");
  assert.equal(status(replacedQueue), "queued");
  assert.equal(status(changedStatus), "queued");
  assert.equal(status(withinQueueWindow), "queued");
  assert.equal(status(oldReview), "failed");
  assert.equal(status(oldQueue), "failed");
  assert.equal(status(backlog), "failed");
  assert.deepEqual(new Set(enqueued), new Set([oldReview.id, oldQueue.id]));
} finally { await actual.organization.delete({ where: { id: org.id } }); await actual.$disconnect(); }
