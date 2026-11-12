import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";
import { startWorkerProcess, until } from "./fixtures/queue-drain-worker-process";
import { localQueueTestDatabaseUrl } from "./queue-test-database";

// A whole rolling update, driven the way a release does it: the admin endpoint's own
// handlers, real pg-boss, and worker processes that are stopped and replaced.
const enabled = process.env.RUN_QUEUE_DB_TESTS === "1";
const secret = "fixture-admin-secret";
type Worker = Awaited<ReturnType<typeof startWorkerProcess>>;

(enabled ? describe : describe.skip)("rolling update with a queue drain, with PostgreSQL", () => {
  let databaseUrl: string;
  let prisma: typeof import("@octopus/db").prisma;
  let route: typeof import("../../app/api/admin/queue-drain/route");
  let NextRequest: typeof import("next/server").NextRequest;
  let boss: PgBoss;
  const queue = `drain_rollout_test_${randomUUID().replaceAll("-", "")}`;
  const workers: Worker[] = [];
  const savedSecret = process.env.ADMIN_API_SECRET;

  beforeAll(async () => {
    databaseUrl = localQueueTestDatabaseUrl(process.env.DATABASE_URL);
    process.env.DATABASE_URL = databaseUrl;
    process.env.ADMIN_API_SECRET = secret;
    mock.module("server-only", () => ({}));
    ({ prisma } = await import("@octopus/db"));
    route = await import("../../app/api/admin/queue-drain/route");
    ({ NextRequest } = await import("next/server"));
    boss = new PgBoss({ connectionString: databaseUrl, supervise: false, schedule: false });
    boss.on("error", () => {});
    await boss.start();
    await boss.createQueue(queue, { retryLimit: 2, expireInSeconds: 60 });
  });

  const reset = async () => {
    for (const worker of workers.splice(0)) { worker.child.kill("SIGKILL"); await worker.child.exited; }
    await prisma.queueDrain.deleteMany();
    await prisma.queueWorkerInstance.deleteMany();
    await prisma.reviewAttemptDelivery.updateMany({ data: { leaseToken: null, leaseUntil: null } });
    await prisma.$executeRaw`DELETE FROM pgboss.job WHERE "state" = 'active' OR "name" = ${queue}`;
  };
  beforeEach(reset);
  afterEach(reset);

  afterAll(async () => {
    if (savedSecret === undefined) delete process.env.ADMIN_API_SECRET; else process.env.ADMIN_API_SECRET = savedSecret;
    await boss.deleteQueue(queue);
    await boss.stop({ graceful: false });
    await prisma.$disconnect();
  });

  // The release's side: every call goes through the endpoint.
  const call = async (method: "GET" | "POST", body?: unknown) => {
    const request = new NextRequest("http://localhost/api/admin/queue-drain", {
      method, headers: { authorization: `Bearer ${secret}` }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await (method === "GET" ? route.GET(request) : route.POST(request));
    expect(response.status).toBe(200);
    return response.json();
  };
  const status = () => call("GET");
  const requestDrain = async (): Promise<number> => (await call("POST", { action: "drain", requestedBy: "rollout test" })).generation;
  const resume = (generation: number) => call("POST", { action: "resume", generation });
  /** Poll as a release does; each poll also renews the lease. */
  const statusWhere = async (check: (status: Awaited<ReturnType<typeof status>>) => unknown, label: string, timeout = 20_000) => {
    let last = await status();
    await until(async () => check(last = await status()), label, timeout);
    return last;
  };

  const start = async (serverId: string, version: string) => {
    const worker = await startWorkerProcess({ queue, databaseUrl, serverId, version });
    workers.push(worker);
    return worker;
  };
  const instance = (worker: Worker) => prisma.queueWorkerInstance.findFirstOrThrow({ where: { serverId: worker.serverId } });
  const acked = (worker: Worker, generation: number) => until(async () => (await instance(worker)).ackedGeneration === generation, `${worker.serverId} acknowledged`);
  const terminate = async (worker: Worker) => { worker.child.kill("SIGTERM"); return worker.child.exited; };

  const send = async (data: { ms: number; retryMs?: number }, options = {}) => (await boss.send(queue, data, options))!;
  const job = async (id: string) => (await prisma.$queryRaw<Array<{ state: string; retries: number }>>`
    SELECT "state"::text AS "state", "retry_count" AS "retries" FROM pgboss.job WHERE "id" = ${id}::uuid`)[0];
  const states = (ids: string[]) => Promise.all(ids.map(async id => (await job(id)).state));
  const completed = (ids: string[]) => until(async () => (await states(ids)).every(state => state === "completed"), "jobs completed", 20_000);
  /** How often each job was started and finished, across every worker process of the test. */
  const runs = (ids: string[], among = workers) => ids.map(id => ({
    started: among.reduce((sum, worker) => sum + worker.count(`start ${id}`), 0),
    finished: among.reduce((sum, worker) => sum + worker.count(`done ${id}`), 0),
  }));
  const once = { started: 1, finished: 1 };
  const executing = (id: string) => until(() => runs([id])[0].started, `job ${id} executing`);

  it("lets two executing jobs and new arrivals survive a rolling update", async () => {
    const old = [await start("old-1", "1.0.0"), await start("old-2", "1.0.0")];
    const running = [await send({ ms: 1200 }), await send({ ms: 2500 })]; // the second stands in for a slow provider
    for (const id of running) await executing(id);

    const generation = await requestDrain();
    const arrivals = [await send({ ms: 0 }), await send({ ms: 0 }), await send({ ms: 0 })];
    expect(await status()).toMatchObject({ state: "draining", generation, quiescent: false, outcome: "draining", activeClaims: [{ queue, count: 2 }] });

    const quiescent = await statusWhere(current => current.quiescent, "quiescent");
    expect(quiescent).toMatchObject({ outcome: "quiescent", activeClaims: [], inlineActive: 0, pendingDeliveries: 0, orphanedClaims: 0 });
    expect((await prisma.queueDrain.findUniqueOrThrow({ where: { id: 1 } })).quiescentAt).not.toBeNull();
    expect(quiescent.instances).toMatchObject([
      { serverId: "old-1", version: "1.0.0", live: true, acked: true },
      { serverId: "old-2", version: "1.0.0", live: true, acked: true },
    ]);
    expect(await states(running)).toEqual(["completed", "completed"]);
    expect(runs(running, old)).toEqual([once, once]);
    expect(await states(arrivals)).toEqual(["created", "created", "created"]);

    expect(await Promise.all(old.map(terminate))).toEqual([0, 0]);
    const fresh = [await start("new-1", "1.1.0"), await start("new-2", "1.1.0")];
    for (const worker of fresh) await acked(worker, generation);
    const replaced = await status();
    expect(replaced.quiescent).toBe(true);
    expect(replaced.instances.filter((item: { live: boolean }) => item.live).map((item: { version: string }) => item.version)).toEqual(["1.1.0", "1.1.0"]);
    expect(fresh.map(worker => worker.count("registered"))).toEqual([0, 0]);
    expect(await states(arrivals)).toEqual(["created", "created", "created"]);

    expect(await resume(generation)).toMatchObject({ resumed: true, status: { state: "claiming" } });
    await completed(arrivals);
    expect(runs(arrivals, fresh)).toEqual([once, once, once]);
    expect(runs([...running, ...arrivals])).toEqual([once, once, once, once, once]);
    expect((await Promise.all([...running, ...arrivals].map(job))).map(item => item.retries)).toEqual([0, 0, 0, 0, 0]);
  }, 60_000);

  it("waits for the job of a worker killed mid-drain, then retries it after resume", async () => {
    const doomed = await start("old-1", "1.0.0");
    const held = await send({ ms: 60_000, retryMs: 0 }, { expireInSeconds: 2 });
    await executing(held);
    const survivor = await start("old-2", "1.0.0");

    const generation = await requestDrain();
    await acked(survivor, generation);
    doomed.child.kill("SIGKILL");
    await doomed.child.exited;

    // Once the dead worker's heartbeat is stale, its job shows as a claim nobody alive owns.
    const orphaned = await statusWhere(current => current.orphanedClaims === 1, "orphaned claim");
    expect(orphaned).toMatchObject({ state: "draining", quiescent: false, activeClaims: [{ queue, count: 1 }] });
    expect(orphaned.instances.find((item: { serverId: string }) => item.serverId === "old-1")).toMatchObject({ live: false, acked: false });

    // pg-boss expires the attempt after the queue timeout; nothing claims it while draining.
    await until(async () => { await boss.supervise(queue); return (await job(held)).state === "retry"; }, "attempt expired", 20_000);
    expect(await statusWhere(current => current.quiescent, "quiescent")).toMatchObject({ state: "draining", generation });
    expect((await job(held)).state).toBe("retry");

    expect(await terminate(survivor)).toBe(0);
    const fresh = await start("new-1", "1.1.0");
    await acked(fresh, generation);
    expect(fresh.count("registered")).toBe(0);
    await resume(generation);
    await completed([held]);
    expect(await job(held)).toEqual({ state: "completed", retries: 1 });
    expect(runs([held], [doomed])).toEqual([{ started: 1, finished: 0 }]);
    expect(runs([held], [fresh])).toEqual([once]);
  }, 60_000);

  it("reports a job that outlasts the deadline and rolls back to the same workers", async () => {
    const worker = await start("old-1", "1.0.0");
    const long = await send({ ms: 4000 });
    await executing(long);
    const generation = await requestDrain();
    const arrivals = [await send({ ms: 0 }), await send({ ms: 0 })];
    // The endpoint's shortest deadline is a minute; bring this one forward.
    await prisma.queueDrain.update({ where: { id: 1 }, data: { deadlineAt: new Date(Date.now() + 500) } });

    // Reading the status past the deadline ends the drain; nothing is cancelled.
    expect(await statusWhere(current => current.outcome === "timed_out" && current.state === "claiming", "timed out and resumed")).toMatchObject({ state: "claiming", generation, quiescent: false });
    expect((await job(long)).state).toBe("active");
    expect(runs([long])).toEqual([{ started: 1, finished: 0 }]);
    expect((await instance(worker)).ackedGeneration).toBeNull();

    // The release's own resume is then a no-op.
    expect(await resume(generation)).toMatchObject({ resumed: false, status: { state: "claiming", outcome: "timed_out" } });
    await completed([long, ...arrivals]);
    expect(runs([long, ...arrivals], [worker])).toEqual([once, once, once]);
    expect((await Promise.all([long, ...arrivals].map(job))).map(item => item.retries)).toEqual([0, 0, 0]);
    expect(worker.count("registered")).toBe(2);
    expect(worker.child.exitCode).toBeNull();
  }, 60_000);

  it("resumes by itself when the release stops polling, and ignores its late resume", async () => {
    const worker = await start("old-1", "1.0.0");
    const generation = await requestDrain();
    await acked(worker, generation);
    const arrival = await send({ ms: 0 });
    // The endpoint's shortest lease is 30 seconds; bring this one forward, then never poll.
    await prisma.queueDrain.update({ where: { id: 1 }, data: { leaseUntil: new Date(Date.now() + 500) } });

    await completed([arrival]);
    expect(runs([arrival])).toEqual([once]);
    const expired = await prisma.queueDrain.findUniqueOrThrow({ where: { id: 1 } });
    expect(expired).toMatchObject({ state: "claiming", generation, resumeReason: "lease_expired" });

    expect(await status()).toMatchObject({ state: "claiming", generation, outcome: "lease_expired", quiescent: false });
    expect(await resume(generation)).toMatchObject({ resumed: false, status: { state: "claiming", outcome: "lease_expired" } });
    expect(await prisma.queueDrain.findUniqueOrThrow({ where: { id: 1 } })).toEqual(expired);
    expect(worker.count("registered")).toBe(2);
  }, 60_000);

  it("does not reopen a worker that is shutting down when the drain is resumed", async () => {
    const leaving = await start("old-1", "1.0.0");
    const running = await send({ ms: 2500 });
    await executing(running);
    const generation = await requestDrain();
    leaving.child.kill("SIGTERM");
    await until(async () => (await instance(leaving)).retiringAt, "retiring");
    const fresh = await start("new-1", "1.1.0");
    await acked(fresh, generation);

    await resume(generation);
    const arrival = await send({ ms: 0 });
    await completed([arrival]);
    expect(runs([arrival], [fresh])).toEqual([once]);
    expect(runs([arrival], [leaving])).toEqual([{ started: 0, finished: 0 }]);

    expect(await leaving.child.exited).toBe(0);
    expect(await job(running)).toEqual({ state: "completed", retries: 0 });
    expect(leaving.count("registered")).toBe(1);
  }, 60_000);
});
