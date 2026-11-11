// Child process for queue-shutdown.db.test.ts: one slow job in flight when SIGTERM arrives.
import { PgBoss } from "pg-boss";
import { setTimeout as delay } from "node:timers/promises";
import { installQueueShutdown } from "../../queue-shutdown";
import { localQueueTestDatabaseUrl } from "../queue-test-database";

const [schema, mode] = process.argv.slice(2);
const boss = new PgBoss({ connectionString: localQueueTestDatabaseUrl(process.env.DATABASE_URL), schema });
boss.on("error", () => {});
await boss.start();
await boss.createQueue("slow", { retryLimit: 0, expireInSeconds: 60 });
await boss.work("slow", { pollingIntervalSeconds: 0.5 }, async () => {
  console.log("job-started");
  await delay(1500);
});
// Stand-in for Next's handler: it exits as soon as HTTP is closed, well before the job ends.
if (mode !== "manual") process.on("SIGTERM", () => { setTimeout(() => process.exit(143), 50); });
if (mode !== "unfixed") installQueueShutdown(boss, 20_000);
const id = await boss.send("slow", {});
console.log(`job-id ${id}`);
await delay(30_000);
process.exit(9);
