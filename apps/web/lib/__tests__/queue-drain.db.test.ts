import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";
import { localQueueTestDatabaseUrl } from "./queue-test-database";

const enabled = process.env.RUN_QUEUE_DB_TESTS === "1";
const minutes = (count: number) => new Date(Date.now() + count * 60_000);

(enabled ? describe : describe.skip)("queue drain state with PostgreSQL", () => {
  let prisma: typeof import("@octopus/db").prisma;
  let drain: typeof import("@/lib/queue-drain");
  let boss: PgBoss;
  let organizationId: string;
  let attemptId: string;
  const queue = `drain_test_${randomUUID().replaceAll("-", "")}`;

  beforeAll(async () => {
    const databaseUrl = localQueueTestDatabaseUrl(process.env.DATABASE_URL);
    process.env.DATABASE_URL = databaseUrl;
    mock.module("server-only", () => ({}));
    ({ prisma } = await import("@octopus/db"));
    drain = await import("@/lib/queue-drain");
    // The real pg-boss table, as the shared test database may already hold it; only the rows are synthetic.
    boss = new PgBoss({ connectionString: databaseUrl, supervise: false, schedule: false });
    boss.on("error", () => {});
    await boss.start();
    await boss.createQueue(queue);
    const id = randomUUID();
    const organization = await prisma.organization.create({ data: { name: "Synthetic", slug: `drain-test-${id}` } });
    organizationId = organization.id;
    const repository = await prisma.repository.create({ data: { organizationId, name: "Synthetic", fullName: "fixture/repo", externalId: id } });
    const pullRequest = await prisma.pullRequest.create({ data: { repositoryId: repository.id, number: 1, title: "Synthetic", url: "", author: "fixture" } });
    attemptId = (await prisma.reviewAttempt.create({ data: { id, pullRequestId: pullRequest.id, coverage: {}, reviewBody: "Synthetic" } })).id;
    await prisma.reviewAttemptDelivery.create({ data: { attemptId } });
  });

  beforeEach(async () => {
    await prisma.queueDrain.deleteMany();
    await prisma.queueWorkerInstance.deleteMany();
    await prisma.reviewAttemptDelivery.updateMany({ data: { leaseToken: null, leaseUntil: null } });
    await prisma.$executeRaw`DELETE FROM pgboss.job WHERE "state" = 'active'`;
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM pgboss.job WHERE "name" = ${queue}`;
    await boss.deleteQueue(queue);
    await boss.stop({ graceful: false });
    await prisma.queueDrain.deleteMany();
    await prisma.queueWorkerInstance.deleteMany();
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  const row = () => prisma.queueDrain.findUniqueOrThrow({ where: { id: 1 } });
  const activeJob = async () => {
    const id = await boss.send(queue, {});
    await prisma.$executeRaw`UPDATE pgboss.job SET "state" = 'active' WHERE "id" = ${id}::uuid`;
  };
  const finishJobs = () => prisma.$executeRaw`UPDATE pgboss.job SET "state" = 'completed' WHERE "state" = 'active'`;
  const deliveryLease = (leaseUntil: Date | null) => prisma.reviewAttemptDelivery.update({ where: { attemptId }, data: { leaseUntil } });
  /** A live instance gets its heartbeat from the library, so liveness is judged on the database clock. */
  const instance = async (serverId: string, workersEnabled: boolean, { dead = false, inlineActive = 0 } = {}) => {
    const { id } = await prisma.queueWorkerInstance.create({
      data: { id: randomUUID(), serverId, version: "test", workersEnabled, inlineActive, ...(dead ? { heartbeatAt: minutes(-5) } : {}) },
    });
    if (!dead) await drain.heartbeat(id, { inlineActive });
    return id;
  };

  it("reports claiming at generation 0 before any drain", async () => {
    expect(await drain.drainStatus()).toMatchObject({ state: "claiming", generation: 0, quiescent: false, outcome: null, orphanedClaims: 0 });
  });

  it("treats a repeated drain request as the same drain and renews its lease", async () => {
    const first = await drain.requestDrain({ requestedBy: "first", leaseSeconds: 30 });
    const before = await row();
    const second = await drain.requestDrain({ requestedBy: "second", leaseSeconds: 300, deadlineSeconds: 5 });
    const after = await row();
    expect(first).toEqual({ generation: 1 });
    expect(second).toEqual({ generation: 1 });
    expect(after.leaseUntil!.getTime()).toBeGreaterThan(before.leaseUntil!.getTime());
    expect(after.deadlineAt).toEqual(before.deadlineAt);
    expect(after.requestedBy).toBe("first");
    expect(before.deadlineAt!.getTime() - before.requestedAt!.getTime()).toBe(drain.DEFAULT_DRAIN_DEADLINE_SECONDS * 1000);
  });

  it("does not revive an expired lease and starts a new generation", async () => {
    const first = await drain.requestDrain({ requestedBy: "first" });
    await prisma.$executeRaw`UPDATE "queue_drain" SET "leaseUntil" = now() - interval '1 second' WHERE "id" = 1`;
    expect(await drain.renewDrainLease(first.generation)).toBe(false);
    const second = await drain.requestDrain({ requestedBy: "second" });
    expect(second.generation).toBe(first.generation + 1);
    expect(await row()).toMatchObject({ generation: second.generation, requestedBy: "second", state: "draining" });
    expect(await drain.renewDrainLease(first.generation)).toBe(false);
  });

  it("resumes only for the current generation and only once", async () => {
    await drain.requestDrain({ requestedBy: "test" });
    expect(await drain.resumeClaiming({ generation: 1, reason: "done" })).toBe(true);
    const { generation } = await drain.requestDrain({ requestedBy: "test" });
    expect(generation).toBe(2);
    expect((await row()).resumeReason).toBeNull();

    expect(await drain.resumeClaiming({ generation: 1, reason: "stale" })).toBe(false);
    expect((await row()).state).toBe("draining");
    expect(await drain.resumeClaiming({ generation, reason: "deployed" })).toBe(true);
    expect(await row()).toMatchObject({ state: "claiming", generation: 2, resumeReason: "deployed" });
    expect(await drain.resumeClaiming({ generation, reason: "again" })).toBe(false);
    expect((await row()).resumeReason).toBe("deployed");
    expect(await drain.renewDrainLease(generation)).toBe(false);
    expect((await drain.drainStatus()).outcome).toBeNull();
  });

  it("resumes by itself only once the lease has expired", async () => {
    const { generation } = await drain.requestDrain({ requestedBy: "test" });
    expect(await drain.expireDrainLease()).toBe(false);
    expect((await row()).state).toBe("draining");

    await prisma.queueDrain.update({ where: { id: 1 }, data: { leaseUntil: minutes(-1) } });
    expect((await drain.drainStatus()).outcome).toBe("lease_expired");
    expect(await drain.renewDrainLease(generation, 60)).toBe(true);
    expect(await drain.expireDrainLease()).toBe(false);

    await prisma.queueDrain.update({ where: { id: 1 }, data: { leaseUntil: minutes(-1) } });
    expect(await drain.expireDrainLease()).toBe(true);
    expect(await row()).toMatchObject({ state: "claiming", generation, resumeReason: "lease_expired" });
    expect(await drain.drainStatus()).toMatchObject({ state: "claiming", outcome: "lease_expired", quiescent: false });
    expect(await drain.expireDrainLease()).toBe(false);
  });

  it("reports a passed deadline without changing anything", async () => {
    const { generation } = await drain.requestDrain({ requestedBy: "test" });
    await activeJob();
    await prisma.queueDrain.update({ where: { id: 1 }, data: { deadlineAt: minutes(-1) } });
    expect(await drain.drainStatus()).toMatchObject({ state: "draining", generation, outcome: "timed_out", quiescent: false });
    expect(await drain.expireDrainLease()).toBe(false);
    expect(await row()).toMatchObject({ state: "draining", generation, resumedAt: null });
    expect((await drain.drainStatus()).activeClaims).toEqual([{ queue, count: 1 }]);
    await finishJobs();
    expect((await drain.drainStatus()).outcome).toBe("quiescent");
  });

  it("is quiescent only once acknowledgements, jobs, inline reviews and deliveries all clear", async () => {
    const { generation } = await drain.requestDrain({ requestedBy: "test" });
    const worker = await instance("engine-1", true);
    const web = await instance("web-1", false, { inlineActive: 2 });
    await drain.acknowledgeDrain(web, generation);
    await activeJob();
    await deliveryLease(minutes(5));

    const status = await drain.drainStatus();
    expect(status).toMatchObject({
      state: "draining", generation, activeClaims: [{ queue, count: 1 }], inlineActive: 2, pendingDeliveries: 1,
      orphanedClaims: 0, quiescent: false, outcome: "draining",
    });
    expect(status.instances).toEqual([
      { serverId: "engine-1", version: "test", workersEnabled: true, live: true, acked: false, inlineActive: 0, retiring: false },
      { serverId: "web-1", version: "test", workersEnabled: false, live: true, acked: true, inlineActive: 2, retiring: false },
    ]);

    await finishJobs();
    await drain.heartbeat(web, { inlineActive: 0 });
    await deliveryLease(null);
    expect(await drain.drainStatus()).toMatchObject({ activeClaims: [], inlineActive: 0, pendingDeliveries: 0, quiescent: false });

    await drain.acknowledgeDrain(worker, generation);
    expect(await drain.drainStatus()).toMatchObject({ quiescent: true, outcome: "quiescent" });

    await activeJob();
    expect((await drain.drainStatus()).quiescent).toBe(false);
    await finishJobs();
    await drain.heartbeat(web, { inlineActive: 1 });
    expect((await drain.drainStatus()).quiescent).toBe(false);
    await drain.heartbeat(web, { inlineActive: 0 });
    await deliveryLease(minutes(5));
    expect((await drain.drainStatus()).quiescent).toBe(false);
    await deliveryLease(minutes(-1));
    expect(await drain.drainStatus()).toMatchObject({ pendingDeliveries: 0, quiescent: true });

    // An acknowledgement of an earlier generation does not count for this one.
    await drain.acknowledgeDrain(worker, generation - 1);
    expect((await drain.drainStatus()).quiescent).toBe(false);
  });

  it("reports the job of a dead unacknowledged worker as orphaned and keeps waiting for it", async () => {
    const { generation } = await drain.requestDrain({ requestedBy: "test" });
    await drain.acknowledgeDrain(await instance("engine-1", true), generation);
    await instance("engine-2", true, { dead: true, inlineActive: 3 });
    await activeJob();

    const status = await drain.drainStatus();
    expect(status).toMatchObject({ orphanedClaims: 1, inlineActive: 0, quiescent: false, outcome: "draining" });
    expect(status.instances.find(item => item.serverId === "engine-2")).toMatchObject({ live: false, acked: false });

    await finishJobs();
    expect(await drain.drainStatus()).toMatchObject({ orphanedClaims: 0, quiescent: true });
  });

  it("ignores a retired instance", async () => {
    const { generation } = await drain.requestDrain({ requestedBy: "test" });
    await drain.acknowledgeDrain(await instance("engine-1", true), generation);
    const retired = await instance("engine-2", true, { inlineActive: 4 });
    expect(await drain.drainStatus()).toMatchObject({ inlineActive: 4, quiescent: false });

    await drain.markRetiring(retired);
    const status = await drain.drainStatus();
    expect(status).toMatchObject({ inlineActive: 0, quiescent: true });
    expect(status.instances.find(item => item.serverId === "engine-2")).toMatchObject({ live: false, retiring: true, acked: false });
  });

  it("increments the generation once for concurrent drain requests", async () => {
    await drain.requestDrain({ requestedBy: "earlier" });
    await drain.resumeClaiming({ generation: 1, reason: "done" });
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => drain.requestDrain({ requestedBy: `caller-${index}` })));
    expect(results).toEqual(Array(8).fill({ generation: 2 }));
    expect((await row()).generation).toBe(2);

    await prisma.queueDrain.deleteMany();
    const fresh = await Promise.all(Array.from({ length: 8 }, (_, index) => drain.requestDrain({ requestedBy: `caller-${index}` })));
    expect(fresh).toEqual(Array(8).fill({ generation: 1 }));
  });

  it("registers an instance from the environment and returns the drain row with each heartbeat", async () => {
    const saved = { ...process.env };
    Object.assign(process.env, { OCTOPUS_SERVER_ID: "wdc-engine-9", NEXT_PUBLIC_APP_VERSION: "9.9.9", ENABLE_REVIEW_WORKERS: "true" });
    try {
      const id = await drain.registerInstance();
      expect(await drain.heartbeat(id, { inlineActive: 1 })).toEqual({ state: "claiming", generation: 0, deadlineAt: null, leaseUntil: null });
      const { generation } = await drain.requestDrain({ requestedBy: "test" });
      const current = await row();
      expect(await drain.heartbeat(id, { inlineActive: 1 })).toEqual({ state: "draining", generation, deadlineAt: current.deadlineAt, leaseUntil: current.leaseUntil });
      expect((await drain.drainStatus()).instances).toEqual([
        { serverId: "wdc-engine-9", version: "9.9.9", workersEnabled: true, live: true, acked: false, inlineActive: 1, retiring: false },
      ]);
    } finally {
      for (const key of ["OCTOPUS_SERVER_ID", "NEXT_PUBLIC_APP_VERSION", "ENABLE_REVIEW_WORKERS"]) {
        if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
      }
    }
  });
});
