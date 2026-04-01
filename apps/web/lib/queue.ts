import { PgBoss } from "pg-boss";
import type { SendOptions } from "pg-boss";

const globalForQueue = globalThis as unknown as { pgBoss?: PgBoss };

function getBoss(): PgBoss {
  if (globalForQueue.pgBoss) return globalForQueue.pgBoss;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for pg-boss");
  }

  const instance = new PgBoss(databaseUrl);
  globalForQueue.pgBoss = instance;
  return instance;
}

let started = false;

export async function startQueue(): Promise<PgBoss> {
  if (started) return getBoss();

  const boss = getBoss();
  await boss.start();
  started = true;

  // Create queues with retry/expiry config
  await boss.createQueue("welcome-email", {
    retryLimit: 3,
    expireInSeconds: 300, // 5 min timeout per attempt
  }).catch(() => {}); // ignore if already exists

  console.log("[queue] pg-boss started");

  // Register all workers
  const { registerWorkers } = await import("./queue-workers");
  await registerWorkers(boss);

  return boss;
}

export async function enqueue<T extends object>(
  name: string,
  data: T,
  options?: SendOptions,
): Promise<string | null> {
  if (!started) {
    await startQueue();
  }
  return getBoss().send(name, data, options);
}

export async function enqueueAfter<T extends object>(
  name: string,
  data: T,
  seconds: number,
  options?: SendOptions | null,
): Promise<string | null> {
  if (!started) {
    await startQueue();
  }
  return getBoss().sendAfter(name, data, options ?? null, seconds);
}
