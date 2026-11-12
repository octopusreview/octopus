// Child process for queue-drain-worker.db.test.ts: one worker process following the drain row.
import { mock } from "bun:test";
import { PgBoss } from "pg-boss";
import { setTimeout as delay } from "node:timers/promises";
import { localQueueTestDatabaseUrl } from "../queue-test-database";

const [queue, mode] = process.argv.slice(2);
process.env.DATABASE_URL = localQueueTestDatabaseUrl(process.env.DATABASE_URL);
mock.module("server-only", () => ({}));
if (mode === "flaky") {
  // SIGUSR2 toggles a database outage as the drain poll sees it.
  let failing = false;
  const actual = { ...(await import("../../queue-drain")) };
  mock.module("../../queue-drain", () => ({
    ...actual,
    heartbeat: async (...args: Parameters<typeof actual.heartbeat>) => {
      if (failing) throw new Error("synthetic-secret-payload");
      return actual.heartbeat(...args);
    },
  }));
  process.on("SIGUSR2", () => { failing = !failing; console.log(`failing ${failing}`); });
}
const { installQueueShutdown } = await import("../../queue-shutdown");
const { fenceWorkers, retireQueueDrainWorker, startQueueDrainWorker } = await import("../../queue-drain-worker");

const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, supervise: false, schedule: false });
boss.on("error", () => {});
await boss.start();
let blockStop = mode === "stop-failure" || mode === "registration-failure";
let failRegistration = mode === "registration-failure";
if (blockStop) {
  const offWork = boss.offWork.bind(boss);
  boss.offWork = async (...args) => {
    if (blockStop) throw new Error("stop failed");
    return offWork(...args);
  };
  process.on("SIGUSR2", () => { blockStop = false; console.log("stop unblocked"); });
}
installQueueShutdown(boss, 20_000, retireQueueDrainWorker);
await startQueueDrainWorker(boss, async queues => {
  const { work } = fenceWorkers(boss, queues);
  // `retryMs` lets a retry be quick after a first attempt that was slow.
  await work<{ ms: number; retryMs?: number }>(queue, { localConcurrency: 2, pollingIntervalSeconds: 0.5, includeMetadata: true }, async ([job]) => {
    console.log(`start ${job.id}`);
    await delay(job.retryCount ? job.data.retryMs ?? job.data.ms : job.data.ms);
    console.log(`done ${job.id}`);
  });
  if (failRegistration) { failRegistration = false; console.log("registration failed"); throw new Error("registration failed"); }
  console.log("registered");
}, 100);
console.log("ready");
await delay(120_000);
process.exit(9);
