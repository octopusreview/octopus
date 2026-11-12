import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";
import { PgBoss } from "pg-boss";
import { localQueueTestDatabaseUrl } from "./queue-test-database";

const enabled = process.env.RUN_QUEUE_DB_TESTS === "1";
const secret = "fixture-admin-secret";

async function until(check: () => unknown, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await delay(25);
  }
}

(enabled ? describe : describe.skip)("queue drain admin endpoint and inline work, with PostgreSQL", () => {
  let prisma: typeof import("@octopus/db").prisma;
  let drain: typeof import("@/lib/queue-drain");
  let worker: typeof import("@/lib/queue-drain-worker");
  let route: typeof import("../../app/api/admin/queue-drain/route");
  let NextRequest: typeof import("next/server").NextRequest;
  const savedSecret = process.env.ADMIN_API_SECRET;

  beforeAll(async () => {
    const databaseUrl = localQueueTestDatabaseUrl(process.env.DATABASE_URL);
    process.env.DATABASE_URL = databaseUrl;
    mock.module("server-only", () => ({}));
    ({ prisma } = await import("@octopus/db"));
    drain = await import("@/lib/queue-drain");
    worker = await import("@/lib/queue-drain-worker");
    route = await import("../../app/api/admin/queue-drain/route");
    ({ NextRequest } = await import("next/server"));
    // drainStatus() reads the real pg-boss table; make sure it exists.
    const boss = new PgBoss({ connectionString: databaseUrl, supervise: false, schedule: false });
    boss.on("error", () => {});
    await boss.start();
    await boss.stop({ graceful: false });
  });

  beforeEach(async () => {
    process.env.ADMIN_API_SECRET = secret;
    await prisma.queueDrain.deleteMany();
    await prisma.reviewAttemptDelivery.updateMany({ data: { leaseToken: null, leaseUntil: null } });
    await prisma.$executeRaw`DELETE FROM pgboss.job WHERE "state" = 'active'`;
  });

  afterAll(async () => {
    if (savedSecret === undefined) delete process.env.ADMIN_API_SECRET; else process.env.ADMIN_API_SECRET = savedSecret;
    await worker.retireQueueDrainWorker(0);
    await prisma.queueDrain.deleteMany();
    await prisma.queueWorkerInstance.deleteMany();
    await prisma.$disconnect();
  });

  const request = (method: "GET" | "POST", body?: unknown, authorization: string | null = `Bearer ${secret}`) =>
    new NextRequest("http://localhost/api/admin/queue-drain", {
      method, headers: authorization ? { authorization } : {},
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  const post = (body: unknown) => route.POST(request("POST", body));
  const row = () => prisma.queueDrain.findUniqueOrThrow({ where: { id: 1 } });

  // This process plays a web instance: it follows the drain row but has no queue workers.
  describe("inline work", () => {
    const instance = () => prisma.queueWorkerInstance.findFirstOrThrow({ where: { serverId: "inline-test" } });
    const reported = (count: number) => until(async () => (await instance()).inlineActive === count, `inlineActive ${count}`);

    beforeAll(async () => {
      await prisma.queueWorkerInstance.deleteMany();
      process.env.OCTOPUS_SERVER_ID = "inline-test";
      await worker.startQueueDrainWorker({ offWork: async () => {} }, undefined, 100);
    });

    it("is reported with the heartbeat and keeps a drain from going quiescent until it ends", async () => {
      let finish!: () => void;
      const running = worker.trackInline(() => new Promise<string>(resolve => { finish = () => resolve("result"); }));
      await reported(1);
      const { generation } = await drain.requestDrain({ requestedBy: "test" });
      await until(async () => (await instance()).ackedGeneration === generation, "acknowledgement");
      expect(await drain.drainStatus()).toMatchObject({ inlineActive: 1, quiescent: false, outcome: "draining" });

      finish();
      expect(await running).toBe("result");
      await reported(0);
      expect(await drain.drainStatus()).toMatchObject({ inlineActive: 0, quiescent: true });
    });

    it("counts work tracked through a second copy of the module, as Next loads it for route handlers", async () => {
      const copy: typeof worker = await import(`../queue-drain-worker.ts?copy=${Date.now()}`);
      expect(copy.trackInline).not.toBe(worker.trackInline);
      let finish!: () => void;
      const running = copy.trackInline(() => new Promise<void>(resolve => { finish = resolve; }));
      await reported(1);
      finish();
      await running;
      await reported(0);
    });

    it("stops counting work that throws", async () => {
      let fail!: () => void;
      const running = worker.trackInline(() => new Promise<never>((_, reject) => { fail = () => reject(new Error("synthetic")); }));
      await reported(1);
      fail();
      await expect(running).rejects.toThrow("synthetic");
      await reported(0);
    });

    it("counts a CLI or Action review for as long as its request runs, and detached work until it settles", async () => {
      const { withExternalReviewActivity } = await import("@/lib/external-review-activity");
      let respond!: () => void;
      const review = withExternalReviewActivity(null, () => new Promise<Response>(resolve => { respond = () => resolve(Response.json({ ok: true })); }));
      let settle!: () => void;
      void worker.trackInline(() => new Promise<void>(resolve => { settle = resolve; })); // not awaited by anything
      await reported(2);
      respond();
      expect((await review).status).toBe(200);
      await reported(1);
      settle();
      await reported(0);
    });
  });

  describe("endpoint", () => {
    it("rejects a missing, wrong or unconfigured secret like the other admin routes", async () => {
      for (const authorization of [null, "Bearer wrong-secret-value-x", "Bearer "]) {
        for (const response of [await route.GET(request("GET", undefined, authorization)), await route.POST(request("POST", { action: "drain", requestedBy: "test" }, authorization))]) {
          expect(response.status).toBe(401);
          expect(await response.json()).toEqual({ error: "Unauthorized" });
        }
      }
      delete process.env.ADMIN_API_SECRET;
      expect((await route.GET(request("GET"))).status).toBe(401);
      expect((await post({ action: "drain", requestedBy: "test" })).status).toBe(401);
      expect(await prisma.queueDrain.count()).toBe(0);
    });

    it("drains, reports status and resumes", async () => {
      const drained = await post({ action: "drain", requestedBy: "deploy v1.2.3", deadlineSeconds: 60, leaseSeconds: 30 });
      expect(drained.status).toBe(200);
      expect(drained.headers.get("cache-control")).toBe("no-store");
      const { generation, status } = await drained.json();
      expect(generation).toBe(1);
      expect(status).toMatchObject({ state: "draining", generation: 1 });
      const stored = await row();
      expect(stored.requestedBy).toBe("deploy v1.2.3");
      expect(stored.deadlineAt!.getTime() - stored.requestedAt!.getTime()).toBe(60_000);

      const again = await (await post({ action: "drain", requestedBy: "someone else" })).json();
      expect(again.generation).toBe(1);

      const observed = await route.GET(request("GET"));
      expect(observed.status).toBe(200);
      expect(await observed.json()).toMatchObject({ state: "draining", generation: 1, activeClaims: [], pendingDeliveries: 0, orphanedClaims: 0 });

      const stale = await post({ action: "resume", generation: 0 });
      expect(stale.status).toBe(200);
      expect(await stale.json()).toMatchObject({ resumed: false, status: { state: "draining", generation: 1 } });

      const resumed = await post({ action: "resume", generation: 1, reason: "deployed" });
      expect(resumed.status).toBe(200);
      expect(await resumed.json()).toMatchObject({ resumed: true, status: { state: "claiming", generation: 1, outcome: null } });
      expect((await row()).resumeReason).toBe("deployed");
      expect(await (await post({ action: "resume", generation: 1 })).json()).toMatchObject({ resumed: false });
    });

    it("renews the lease on GET during a drain and changes nothing otherwise", async () => {
      const before = await route.GET(request("GET"));
      expect(await before.json()).toMatchObject({ state: "claiming", generation: 0, outcome: null });
      expect(await prisma.queueDrain.count()).toBe(0);

      await post({ action: "drain", requestedBy: "test", leaseSeconds: 30 });
      const short = (await row()).leaseUntil!;
      const body = await (await route.GET(request("GET"))).json();
      const renewed = (await row()).leaseUntil!;
      expect(renewed.getTime()).toBeGreaterThan(short.getTime() + 60_000);
      expect(new Date(body.leaseUntil)).toEqual(renewed);

      await post({ action: "resume", generation: 1 });
      const resumedRow = await row();
      await route.GET(request("GET"));
      expect(await row()).toEqual(resumedRow);
    });

    it("lets an expired lease lapse instead of reviving it", async () => {
      await post({ action: "drain", requestedBy: "test" });
      const expired = new Date(Date.now() - 60_000);
      await prisma.queueDrain.update({ where: { id: 1 }, data: { leaseUntil: expired } });
      expect(await (await route.GET(request("GET"))).json()).toMatchObject({ outcome: "lease_expired" });
      expect((await row()).leaseUntil).toEqual(expired);
    });

    it("rejects malformed requests without echoing them", async () => {
      const marker = "echo-marker-7f3a";
      const bodies: unknown[] = [
        "{not json", `"${marker}"`, [marker], null, {},
        { action: marker }, { action: "drain" }, { action: "drain", requestedBy: "" }, { action: "drain", requestedBy: 7 },
        { action: "drain", requestedBy: `${marker}\n` }, { action: "drain", requestedBy: `${marker}\u0000` },
        { action: "drain", requestedBy: marker.repeat(10) }, { action: "drain", requestedBy: `${marker}é` },
        { action: "drain", requestedBy: marker, deadlineSeconds: 59 }, { action: "drain", requestedBy: marker, deadlineSeconds: 3601 },
        { action: "drain", requestedBy: marker, deadlineSeconds: 90.5 }, { action: "drain", requestedBy: marker, deadlineSeconds: "600" },
        { action: "drain", requestedBy: marker, leaseSeconds: 29 }, { action: "drain", requestedBy: marker, leaseSeconds: 601 },
        { action: "resume" }, { action: "resume", generation: -1 }, { action: "resume", generation: "1" }, { action: "resume", generation: 1.5 },
        { action: "resume", generation: 1, reason: `${marker}\t` }, { action: "resume", generation: 1, reason: "lease_expired" },
      ];
      for (const body of bodies) {
        const response = await post(body);
        const text = await response.text();
        expect(response.status, JSON.stringify(body)).toBe(400);
        expect(JSON.parse(text)).toEqual({ error: "Invalid request" });
      }
      expect(await prisma.queueDrain.count()).toBe(0);
    });

    it("accepts the stated bounds", async () => {
      expect((await post({ action: "drain", requestedBy: "x".repeat(100), deadlineSeconds: 3600, leaseSeconds: 600 })).status).toBe(200);
      expect((await post({ action: "resume", generation: 1, reason: "y".repeat(100) })).status).toBe(200);
      expect((await post({ action: "drain", requestedBy: "x", deadlineSeconds: 60, leaseSeconds: 30 })).status).toBe(200);
    });
  });
});
