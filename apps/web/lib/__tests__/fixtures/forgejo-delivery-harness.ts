import { mock } from "bun:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { Prisma as PrismaTypes } from "@octopus/db";

assert.match(new URL(process.env.DATABASE_URL!).pathname, /test/i);
mock.module("server-only", () => ({}));
const { prisma: actual, Prisma } = await import("@octopus/db");
const phase = process.argv[2];
const secret = "fixture-secret", sha = "a".repeat(40);
let jobInserted = false;
let completeFirst: (() => Promise<void>) | undefined;
let admissionWrites = 0;
let admissionReads = 0;
const wrapped = new Proxy(actual, { get(target, key, receiver) {
  if (key !== "$transaction") return Reflect.get(target, key, receiver);
  return async (work: (tx: PrismaTypes.TransactionClient) => Promise<unknown>) => {
    const result = await actual.$transaction(async tx => {
      const client = new Proxy(tx, { get(target, key, receiver) {
        if (key === "pullRequest") return new Proxy(tx.pullRequest, { get(delegate, method, receiver) {
          if (method === "findUnique") return async (...args: Parameters<typeof tx.pullRequest.findUnique>) => {
            admissionReads++;
            if (phase === "automatic_metadata_race") {
              const finish = completeFirst; completeFirst = undefined; await finish?.();
            }
            return tx.pullRequest.findUnique(...args);
          };
          if (method === "updateManyAndReturn") return async (...args: Parameters<typeof tx.pullRequest.updateManyAndReturn>) => {
            admissionWrites++;
            if (phase === "automatic_write_race") {
              const finish = completeFirst; completeFirst = undefined; await finish?.();
            }
            return tx.pullRequest.updateManyAndReturn(...args);
          };
          return Reflect.get(delegate, method, receiver);
        } });
        if (key !== "$queryRawUnsafe") return Reflect.get(target, key, receiver);
        return async (query: string, ...values: unknown[]) => {
          if (phase === "before_enqueue") throw new Error("simulated restart before enqueue");
          const rows = await tx.$queryRawUnsafe(query, ...values);
          jobInserted = true;
          if (phase === "after_enqueue") throw new Error("simulated restart after enqueue before commit");
          return rows;
        };
      } });
      return work(client);
    }, { timeout: 30_000 });
    if (phase === "after_commit") throw new Error("simulated restart before HTTP acknowledgement");
    return result;
  };
} });
mock.module("@octopus/db", () => ({ prisma: wrapped, Prisma }));
mock.module("@/lib/forgejo", () => ({
  runWithForgejoRepository: async (_id: string, callback: () => Promise<unknown>) => callback(),
  getPullRequestDetails: async () => ({ number: 7, title: "Test", author: "author", url: "https://forge.example/team/repo/pulls/7", headSha: sha, state: "open", draft: false }),
  createPullRequestComment: async () => assert.fail("publication belongs to the worker after commit"),
}));
mock.module("@/lib/pubby", () => ({ pubby: { trigger: async () => assert.fail("no precommit notification") } }));
mock.module("@/lib/events", () => ({ eventBus: { emit: () => assert.fail("no precommit event") } }));
const { startQueue } = await import("../../queue");
const boss = await startQueue();
try {
  await actual.organization.upsert({ where: { id: "forgejo-delivery-test" }, update: {}, create: { id: "forgejo-delivery-test", name: "Test", slug: "forgejo-delivery-test" } });
  await actual.forgejoIntegration.upsert({ where: { id: "forgejo-delivery-test" }, update: {}, create: {
    id: "forgejo-delivery-test", organizationId: "forgejo-delivery-test", forgejoHost: "https://forge.example", username: "bot", accessTokenEnc: "fixture", webhookSecret: secret,
  } });
  await actual.repository.upsert({ where: { id: "forgejo-delivery-test" }, update: {}, create: {
    id: "forgejo-delivery-test", organizationId: "forgejo-delivery-test", provider: "forgejo", externalId: "https://forge.example:42", name: "repo", fullName: "team/repo",
  } });
  const { POST } = await import("../../../app/api/forgejo/webhook/[integrationId]/route");
  const automatic = phase.startsWith("automatic_");
  const raw = JSON.stringify(automatic
    ? { action: "edited", repository: { id: 42, full_name: "team/repo" }, pull_request: { number: 7, head: { sha } }, changes: { title: { from: phase } } }
    : { action: "created", repository: { id: 42, full_name: "team/repo" }, issue: { number: 7, pull_request: {} }, comment: { id: phase === "manual_rereview" ? 6 : 5, body: "/octopus review", user: { login: "member" } } });
  const deliver = () => POST(new Request("https://octopus.example/webhook", { method: "POST", body: raw, headers: {
    "x-forgejo-event": automatic ? "pull_request" : "issue_comment", "x-forgejo-signature": createHmac("sha256", secret).update(raw).digest("hex"),
  } }), { params: Promise.resolve({ integrationId: "forgejo-delivery-test" }) });
  const jobCount = async () => (await actual.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pgboss.job WHERE name = 'process-review'`)[0].count;
  if (automatic) {
    const before = await actual.pullRequest.findFirstOrThrow({ where: { repositoryId: "forgejo-delivery-test" } });
    await actual.reviewAttempt.deleteMany({ where: { pullRequestId: before.id } });
    await actual.pullRequest.update({ where: { id: before.id }, data: { status: phase === "automatic_metadata_race" ? "reviewing" : "failed", updatedAt: new Date(0) } });
    completeFirst = async () => {
      await actual.$transaction(async tx => {
        await tx.reviewAttempt.create({ data: { id: phase, pullRequestId: before.id, headSha: sha, coverage: {}, reviewBody: "Completed first review" } });
        if (phase === "automatic_metadata_race") await tx.pullRequest.update({ where: { id: before.id }, data: { status: "completed", reviewBody: "Completed first review" } });
      });
    };
    assert.equal((await deliver()).status, 200);
    assert.equal(completeFirst, undefined, "the first review must finish while the second delivery is in flight");
    const after = await actual.pullRequest.findUniqueOrThrow({ where: { id: before.id } });
    assert.equal(after.reviewRequestVersion, 1);
    assert.equal(after.reviewBody, "Completed first review");
    assert.equal(await jobCount(), 1n);
    if (phase === "automatic_write_race") {
      assert.equal(admissionWrites, 1, "the conditional write must reject a newly archived attempt");
      assert.equal(admissionReads, 2, "the retry must recheck the completed attempt");
    }
  } else if (phase === "manual_rereview") {
    const before = await actual.pullRequest.findFirstOrThrow({ where: { repositoryId: "forgejo-delivery-test" } });
    await actual.pullRequest.update({ where: { id: before.id }, data: { status: "completed" } });
    await actual.reviewAttemptOutcome.create({ data: {
      organizationId: "forgejo-delivery-test", repositoryId: "forgejo-delivery-test", pullRequestId: before.id,
      requestVersion: 1, kind: "not_assessed", tries: 1, firstTriedAt: new Date(),
    } });
    assert.equal((await deliver()).status, 200);
    const after = await actual.pullRequest.findUniqueOrThrow({ where: { id: before.id } });
    assert.equal(after.reviewRequestVersion, 2);
    assert.equal(after.status, "pending");
    assert.equal(await jobCount(), 2n);
    let superseded = false;
    for (let i = 0; i < 200; i++) {
      const outcome = await actual.reviewAttemptOutcome.findUniqueOrThrow({ where: {
        pullRequestId_requestVersion: { pullRequestId: before.id, requestVersion: 1 },
      } });
      if (outcome.outcome === "superseded") { superseded = true; break; }
      await Bun.sleep(5);
    }
    assert.ok(superseded, "committed webhook admission schedules superseding separately");
  } else if (phase === "replay") {
    const before = await actual.pullRequest.findFirstOrThrow({ where: { repositoryId: "forgejo-delivery-test" } });
    assert.equal(before.reviewRequestVersion, 1);
    await actual.pullRequest.update({ where: { id: before.id }, data: { status: "completed", reviewBody: "Completed first review" } });
    await actual.webhookDelivery.updateMany({ where: { provider: "forgejo" }, data: { lastSeenAt: new Date(0) } });
    const { enforceWebhookDeliveryRetention } = await import("../../webhook-tenant");
    await enforceWebhookDeliveryRetention(30);
    assert.equal((await deliver()).status, 200);
    const after = await actual.pullRequest.findUniqueOrThrow({ where: { id: before.id } });
    assert.equal(after.reviewRequestVersion, 1);
    assert.equal(after.reviewBody, "Completed first review");
    assert.equal(await jobCount(), 1n);
  } else {
    await assert.rejects(deliver(), /simulated restart/);
    const committed = phase === "after_commit";
    assert.equal(jobInserted, phase !== "before_enqueue");
    assert.equal(await jobCount(), committed ? 1n : 0n);
    assert.equal(await actual.pullRequest.count({ where: { repositoryId: "forgejo-delivery-test" } }), committed ? 1 : 0);
    assert.equal(await actual.webhookDelivery.count({ where: { provider: "forgejo" } }), committed ? 1 : 0);
  }
} finally {
  await boss.stop({ graceful: false });
  await actual.$disconnect();
}
console.log(phase + " passed");
