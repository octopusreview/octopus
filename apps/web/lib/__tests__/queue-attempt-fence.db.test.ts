import { expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PgBoss } from "pg-boss";

const enabled = process.env.RUN_QUEUE_DB_TESTS === "1";
const databaseUrl = process.env.DATABASE_URL;
if (enabled && (!databaseUrl || !/(^|[-_])test($|[-_])/.test(new URL(databaseUrl).pathname.slice(1).toLowerCase()))) {
  throw new Error("Queue DB tests require a dedicated test database");
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([promise, delay(10_000).then(() => { throw new Error(`Timed out: ${label}`); })]);
}

it.skipIf(!enabled)("continues fetching after a handler times out", async () => {
  const schema = `pgboss_test_${randomUUID().replaceAll("-", "")}`;
  const boss = new PgBoss({ connectionString: databaseUrl!, schema });
  boss.on("error", () => {});
  const firstEntered = gate(), firstRelease = gate(), secondEntered = gate();
  let firstSignal: AbortSignal | undefined;
  try {
    await boss.start();
    const name = "timeout_worker";
    await boss.createQueue(name, { retryLimit: 0, expireInSeconds: 1 });
    await boss.work<{ attempt: string }>(name, { pollingIntervalSeconds: 0.5 }, async ([job]) => {
      if (job.data.attempt === "first") {
        firstSignal = job.signal;
        firstEntered.resolve();
        await firstRelease.promise;
      } else {
        secondEntered.resolve();
      }
    });
    const firstId = await boss.send(name, { attempt: "first" });
    await bounded(firstEntered.promise, "first handler");
    await boss.send(name, { attempt: "second" });
    await bounded(secondEntered.promise, "next job after timeout");
    expect(firstSignal?.aborted).toBe(true);
    expect((await boss.getJobById(name, firstId!))?.state).toBe("failed");
  } finally {
    firstRelease.resolve();
    await boss.stop({ graceful: false, close: false }).catch(() => {});
    await boss.getDb().executeSql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await boss.getDb().close().catch(() => {});
  }
}, 30_000);

it.skipIf(!enabled)("does not let an abandoned worker complete a later retry", async () => {
  const schema = `pgboss_test_${randomUUID().replaceAll("-", "")}`;
  const first = new PgBoss({ connectionString: databaseUrl!, schema });
  const second = new PgBoss({ connectionString: databaseUrl!, schema });
  first.on("error", () => {});
  second.on("error", () => {});
  const firstEntered = gate(), firstAborted = gate(), firstRelease = gate();
  const completionEntered = gate(), completionRelease = gate(), completionSettled = gate();
  const secondEntered = gate(), secondRelease = gate();
  const name = "review_attempt_fence";
  let intercept = false;
  let completionExecuted = false;
  let firstReturned = false;
  let firstMetadata: { retryCount: number; retryLimit: number; startedOn: Date } | undefined;
  let secondRetryCount: number | undefined;
  let stopFirst: Promise<void> | undefined;
  try {
    await first.start();
    await second.start();
    await first.createQueue(name, { retryLimit: 2, retryDelay: 0, expireInSeconds: 60 });
    const db = first.getDb();
    const execute = db.executeSql.bind(db);
    db.executeSql = async (sql, values) => {
      if (intercept && sql.includes("SET completed_on =") && values?.[0] === name) {
        completionEntered.resolve();
        await completionRelease.promise;
        try {
          const result = await execute(sql, values);
          completionExecuted = true;
          return result;
        } finally { completionSettled.resolve(); }
      }
      return execute(sql, values);
    };
    await first.work(name, { pollingIntervalSeconds: 0.5, includeMetadata: true }, async ([job]) => {
      firstMetadata = { retryCount: job.retryCount, retryLimit: job.retryLimit, startedOn: job.startedOn };
      firstEntered.resolve();
      if (!job.signal.aborted) await new Promise<void>((done) => job.signal.addEventListener("abort", () => done(), { once: true }));
      firstAborted.resolve();
      await firstRelease.promise;
      firstReturned = true;
    });
    const id = await first.send(name, { synthetic: true });
    expect(id).toBeTruthy();
    await bounded(firstEntered.promise, "first attempt");
    expect(firstMetadata?.retryCount).toBe(0);
    expect(firstMetadata?.retryLimit).toBe(2);
    expect(firstMetadata?.startedOn).toBeInstanceOf(Date);
    intercept = true;
    stopFirst = first.stop({ graceful: false, close: false });
    await bounded(firstAborted.promise, "first attempt abort");
    await bounded(completionEntered.promise, "stale completion");
    await second.work(name, { pollingIntervalSeconds: 0.5, includeMetadata: true }, async ([job]) => {
      secondRetryCount = job.retryCount;
      secondEntered.resolve();
      await secondRelease.promise;
    });
    await bounded(secondEntered.promise, "retry attempt");
    expect(secondRetryCount).toBe(1);
    expect((await second.getJobById(name, id!))?.state).toBe("active");
    completionRelease.resolve();
    await bounded(completionSettled.promise, "stale completion settlement");
    expect(completionExecuted).toBe(true);
    await bounded(stopFirst, "first worker shutdown");
    expect(firstReturned).toBe(false);
    expect((await second.getJobById(name, id!))?.state).toBe("active");
    secondRelease.resolve();
    for (let i = 0; i < 50; i++) {
      if ((await second.getJobById(name, id!))?.state === "completed") break;
      await delay(100);
    }
    expect((await second.getJobById(name, id!))?.state).toBe("completed");
  } finally {
    completionRelease.resolve();
    firstRelease.resolve();
    secondRelease.resolve();
    await stopFirst?.catch(() => {});
    await second.stop({ graceful: false, close: false }).catch(() => {});
    await first.getDb().executeSql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await first.getDb().close().catch(() => {});
    await second.getDb().close().catch(() => {});
  }
}, 30_000);

it.skipIf(!enabled)("does not let an abandoned worker fail a later retry", async () => {
  const schema = `pgboss_test_${randomUUID().replaceAll("-", "")}`;
  const first = new PgBoss({ connectionString: databaseUrl!, schema });
  const second = new PgBoss({ connectionString: databaseUrl!, schema });
  first.on("error", () => {});
  second.on("error", () => {});
  const failureEntered = gate(), failureRelease = gate(), failureSettled = gate();
  const secondEntered = gate(), secondRelease = gate();
  const name = "review_attempt_fence";
  let failureExecuted = false;
  try {
    await first.start();
    await second.start();
    await first.createQueue(name, { retryLimit: 2, retryDelay: 0, expireInSeconds: 60 });
    const db = first.getDb();
    const execute = db.executeSql.bind(db);
    db.executeSql = async (sql, values) => {
      if (sql.includes("deleted_jobs AS (") && values?.[0] === name) {
        failureEntered.resolve();
        await failureRelease.promise;
        try {
          const result = await execute(sql, values);
          failureExecuted = true;
          return result;
        }
        finally { failureSettled.resolve(); }
      }
      return execute(sql, values);
    };
    await first.work(name, { pollingIntervalSeconds: 0.5 }, async () => {
      throw new Error("synthetic first attempt failure");
    });
    const id = await first.send(name, { synthetic: true });
    expect(id).toBeTruthy();
    await bounded(failureEntered.promise, "stale failure");
    expect((await second.fail(name, id!, "abandoned attempt")).affected).toBe(1);
    let secondRetryCount: number | undefined;
    await second.work(name, { pollingIntervalSeconds: 0.5, includeMetadata: true }, async ([job]) => {
      secondRetryCount = job.retryCount;
      secondEntered.resolve();
      await secondRelease.promise;
    });
    await bounded(secondEntered.promise, "retry attempt");
    expect(secondRetryCount).toBe(1);
    expect((await second.getJobById(name, id!))?.state).toBe("active");
    failureRelease.resolve();
    await bounded(failureSettled.promise, "stale failure settlement");
    expect(failureExecuted).toBe(true);
    const activeRetry = await second.getJobById(name, id!);
    expect(activeRetry?.state).toBe("active");
    expect(activeRetry?.retryCount).toBe(1);
    secondRelease.resolve();
    for (let i = 0; i < 50; i++) {
      if ((await second.getJobById(name, id!))?.state === "completed") break;
      await delay(100);
    }
    expect((await second.getJobById(name, id!))?.state).toBe("completed");
  } finally {
    failureRelease.resolve();
    secondRelease.resolve();
    await first.stop({ graceful: false, close: false }).catch(() => {});
    await second.stop({ graceful: false, close: false }).catch(() => {});
    await first.getDb().executeSql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await first.getDb().close().catch(() => {});
    await second.getDb().close().catch(() => {});
  }
}, 30_000);
