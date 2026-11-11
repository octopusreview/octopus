import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PgBoss } from "pg-boss";
import { startWorkerProcess, until } from "./fixtures/queue-drain-worker-process";
import { localQueueTestDatabaseUrl } from "./queue-test-database";

const enabled = process.env.RUN_QUEUE_DB_TESTS === "1";

(enabled ? describe : describe.skip)("queue workers following the drain row, with PostgreSQL", () => {
  let databaseUrl: string;
  let prisma: typeof import("@octopus/db").prisma;
  let drain: typeof import("@/lib/queue-drain");
  let boss: PgBoss;
  const queue = `drain_worker_test_${randomUUID().replaceAll("-", "")}`;
  const children: Array<ReturnType<typeof Bun.spawn>> = [];

  beforeAll(async () => {
    databaseUrl = localQueueTestDatabaseUrl(process.env.DATABASE_URL);
    process.env.DATABASE_URL = databaseUrl;
    mock.module("server-only", () => ({}));
    ({ prisma } = await import("@octopus/db"));
    drain = await import("@/lib/queue-drain");
    boss = new PgBoss({ connectionString: databaseUrl, supervise: false, schedule: false });
    boss.on("error", () => {});
    await boss.start();
    await boss.createQueue(queue, { retryLimit: 2, expireInSeconds: 60 });
  });

  const reset = async () => {
    for (const child of children.splice(0)) { child.kill("SIGKILL"); await child.exited; }
    await prisma.queueDrain.deleteMany();
    await prisma.queueWorkerInstance.deleteMany();
    await prisma.reviewAttemptDelivery.updateMany({ data: { leaseToken: null, leaseUntil: null } });
    await prisma.$executeRaw`DELETE FROM pgboss.job WHERE "state" = 'active' OR "name" = ${queue}`;
  };
  beforeEach(reset);
  afterEach(reset);

  afterAll(async () => {
    await boss.deleteQueue(queue);
    await boss.stop({ graceful: false });
    await prisma.$disconnect();
  });

  async function startWorker(serverId: string, mode = "") {
    const worker = await startWorkerProcess({ queue, databaseUrl, serverId, mode });
    children.push(worker.child);
    const instance = () => prisma.queueWorkerInstance.findFirstOrThrow({ where: { serverId } });
    return { ...worker, instance, acked: (generation: number) => until(async () => (await instance()).ackedGeneration === generation, "acknowledgement") };
  }
  const send = async (ms: number) => (await boss.send(queue, { ms }))!;
  const state = async (id: string) => (await prisma.$queryRaw<Array<{ state: string }>>`
    SELECT "state"::text AS "state" FROM pgboss.job WHERE "id" = ${id}::uuid`)[0]?.state;
  const completed = (id: string) => until(async () => await state(id) === "completed", `job ${id} completed`);

  it("claims and completes a job when no drain was ever requested", async () => {
    const worker = await startWorker("engine-1");
    const job = await send(0);
    await completed(job);
    expect(await prisma.queueDrain.count()).toBe(0);
    expect(await worker.instance()).toMatchObject({ workersEnabled: true, ackedGeneration: null, retiringAt: null });
    expect(await drain.drainStatus()).toMatchObject({ state: "claiming", outcome: null, instances: [{ serverId: "engine-1", live: true }] });
  }, 30_000);

  it("lets in-flight jobs finish, leaves arrivals queued, acknowledges afterwards and resumes", async () => {
    const worker = await startWorker("engine-1");
    const running = [await send(2000), await send(2000)];
    for (const job of running) await worker.saw(`start ${job}`);
    const { generation } = await drain.requestDrain({ requestedBy: "test" });
    const arrivals = [await send(0), await send(0)];

    await delay(700); // several drain polls and a pg-boss fetch interval
    expect(running.map(job => worker.count(`done ${job}`))).toEqual([0, 0]);
    expect((await worker.instance()).ackedGeneration).toBeNull();
    expect(await drain.drainStatus()).toMatchObject({ quiescent: false, outcome: "draining", activeClaims: [{ queue, count: 2 }], orphanedClaims: 0 });

    for (const job of running) await completed(job);
    await worker.acked(generation);
    const [{ finished }] = await prisma.$queryRaw<Array<{ finished: Date }>>`
      SELECT max("completed_on") AS "finished" FROM pgboss.job WHERE "id"::text = ANY(${running})`;
    expect((await worker.instance()).ackedAt!.getTime()).toBeGreaterThanOrEqual(finished.getTime() - 1);
    await delay(700);
    expect(await Promise.all(arrivals.map(state))).toEqual(["created", "created"]);
    expect(await drain.drainStatus()).toMatchObject({
      quiescent: true, outcome: "quiescent", activeClaims: [], instances: [{ serverId: "engine-1", live: true, acked: true }],
    });

    expect(await drain.resumeClaiming({ generation, reason: "test" })).toBe(true);
    for (const job of arrivals) await completed(job);
    await delay(700);
    expect([...running, ...arrivals].map(job => worker.count(`start ${job}`))).toEqual([1, 1, 1, 1]);
    expect(worker.count("registered")).toBe(2);
  }, 30_000);

  it("reports timed_out past the deadline while a slow job keeps running untouched", async () => {
    const worker = await startWorker("engine-1");
    const job = await send(2500);
    await worker.saw(`start ${job}`);
    const { generation } = await drain.requestDrain({ requestedBy: "test", deadlineSeconds: 1 });
    await delay(1300);
    expect(await drain.drainStatus()).toMatchObject({ state: "draining", generation, quiescent: false, outcome: "timed_out" });
    expect(await state(job)).toBe("active");
    expect((await worker.instance()).ackedGeneration).toBeNull();

    await completed(job);
    expect(worker.count(`done ${job}`)).toBe(1);
    await until(async () => (await drain.drainStatus()).quiescent, "quiescent");
    expect(await prisma.queueDrain.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({ state: "draining", generation });
  }, 30_000);

  it("shows the job of a worker killed without acknowledging as an orphaned claim", async () => {
    const worker = await startWorker("engine-1");
    const job = await send(30_000);
    await worker.saw(`start ${job}`);
    await drain.requestDrain({ requestedBy: "test" });
    await delay(300);
    worker.child.kill("SIGKILL");
    await worker.child.exited;
    // Age the heartbeat instead of waiting out the liveness window.
    await prisma.queueWorkerInstance.updateMany({ data: { heartbeatAt: new Date(Date.now() - 5 * 60_000) } });

    const status = await drain.drainStatus();
    expect(status).toMatchObject({ quiescent: false, orphanedClaims: 1, activeClaims: [{ queue, count: 1 }], outcome: "draining" });
    expect(status.instances).toMatchObject([{ serverId: "engine-1", live: false, acked: false }]);
    expect(await state(job)).toBe("active");
  }, 30_000);

  it("does not claim when started during a drain, acknowledges, and claims after resume", async () => {
    const { generation } = await drain.requestDrain({ requestedBy: "test" });
    const job = await send(0);
    const worker = await startWorker("engine-2");
    await worker.acked(generation);
    await delay(700);
    expect(worker.count("registered")).toBe(0);
    expect(await state(job)).toBe("created");
    expect((await drain.drainStatus()).quiescent).toBe(true);

    await drain.resumeClaiming({ generation, reason: "test" });
    await completed(job);
    expect(worker.count(`start ${job}`)).toBe(1);
    expect(worker.count("registered")).toBe(1);
  }, 30_000);

  it("follows repeated drain and resume cycles and ignores a stale resume", async () => {
    const worker = await startWorker("engine-1");
    for (const cycle of [1, 2]) {
      const { generation } = await drain.requestDrain({ requestedBy: "test" });
      expect(generation).toBe(cycle);
      await worker.acked(generation);
      const job = await send(0);
      expect(await drain.resumeClaiming({ generation: generation - 1, reason: "stale" })).toBe(false);
      await delay(700);
      expect(await state(job)).toBe("created");

      expect(await drain.resumeClaiming({ generation, reason: "test" })).toBe(true);
      await completed(job);
      await delay(300);
      expect(worker.count(`start ${job}`)).toBe(1);
      expect(worker.count("registered")).toBe(cycle + 1);
    }
  }, 30_000);

  it("does not reopen a worker that received SIGTERM during a drain", async () => {
    const worker = await startWorker("engine-1");
    const running = await send(2000);
    await worker.saw(`start ${running}`);
    const { generation } = await drain.requestDrain({ requestedBy: "test" });
    await delay(300);
    worker.child.kill("SIGTERM");
    await until(async () => (await worker.instance()).retiringAt, "retiring");
    await drain.resumeClaiming({ generation, reason: "test" });
    const arrival = await send(0);

    expect(await worker.child.exited).toBe(0);
    expect(await state(running)).toBe("completed");
    expect(await state(arrival)).toBe("created");
    expect(worker.count("registered")).toBe(1);
    expect(worker.count(`start ${arrival}`)).toBe(0);
  }, 30_000);

  it("resumes by itself when the drain lease expires", async () => {
    const worker = await startWorker("engine-1");
    const { generation } = await drain.requestDrain({ requestedBy: "test", leaseSeconds: 1 });
    await worker.acked(generation);
    const job = await send(0);
    await completed(job);
    expect(await prisma.queueDrain.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({ state: "claiming", generation, resumeReason: "lease_expired" });
    expect(worker.count("registered")).toBe(2);
  }, 30_000);

  it("does not work a job fetched by a worker that slept through the drain request", async () => {
    const worker = await startWorker("engine-1");
    process.kill(worker.child.pid, "SIGSTOP"); // Bun's child.kill() does not deliver this one
    await delay(300);
    const frozenAt = (await worker.instance()).heartbeatAt;
    const { generation } = await drain.requestDrain({ requestedBy: "test" });
    const job = await send(0);
    await delay(1000);
    expect((await worker.instance()).heartbeatAt).toEqual(frozenAt);
    process.kill(worker.child.pid, "SIGCONT");
    await worker.acked(generation);
    await delay(700);
    expect(worker.count(`start ${job}`)).toBe(0);
    expect(["created", "retry"]).toContain(await state(job));

    await drain.resumeClaiming({ generation, reason: "test" });
    await completed(job);
    expect(worker.count(`start ${job}`)).toBe(1);
  }, 30_000);

  it("keeps working through failed polls and logs only the error name", async () => {
    const worker = await startWorker("engine-1", "flaky");
    process.kill(worker.child.pid, "SIGUSR2");
    await worker.saw("failing true");
    const job = await send(0);
    await completed(job);
    await until(() => worker.output.stderr.includes("[queue] Drain poll failed: Error"), "failure log");
    expect(worker.output.stderr).not.toContain("synthetic-secret-payload");
    expect(worker.child.exitCode).toBeNull();

    process.kill(worker.child.pid, "SIGUSR2");
    await worker.saw("failing false");
    const { generation } = await drain.requestDrain({ requestedBy: "test" });
    await worker.acked(generation);
  }, 30_000);
});

it.skipIf(!enabled)("pg-boss fetches again when work() follows offWork()", async () => {
  const schema = `pgboss_test_${randomUUID().replaceAll("-", "")}`;
  const boss = new PgBoss({ connectionString: localQueueTestDatabaseUrl(process.env.DATABASE_URL), schema });
  boss.on("error", () => {});
  const worked: string[] = [];
  let finished = false;
  const work = () => boss.work<{ ms: number }>("resumable", { pollingIntervalSeconds: 0.5 }, async ([job]) => {
    await delay(job.data.ms);
    worked.push(job.id);
    finished = true;
  });
  try {
    await boss.start();
    await boss.createQueue("resumable", { retryLimit: 0, expireInSeconds: 60 });
    await work();
    const first = (await boss.send("resumable", { ms: 1000 }))!;
    await until(async () => (await boss.getJobById("resumable", first))?.state === "active", "first job active");
    await boss.offWork("resumable", { wait: true });
    expect(finished).toBe(true); // offWork waited for the handler in flight

    const second = (await boss.send("resumable", { ms: 0 }))!;
    await delay(1500);
    expect((await boss.getJobById("resumable", second))?.state).toBe("created");

    await work();
    await until(async () => (await boss.getJobById("resumable", second))?.state === "completed", "second job completed");
    expect(worked).toEqual([first, second]);
  } finally {
    await boss.stop({ graceful: false, close: false }).catch(() => {});
    await boss.getDb().executeSql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await boss.getDb().close().catch(() => {});
  }
}, 30_000);
