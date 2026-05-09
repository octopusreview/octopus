import { PgBoss } from "pg-boss";
import type { SendOptions } from "pg-boss";
import { prisma } from "@octopus/db";

export interface QueueConfig {
  reviewTimeoutSeconds: number;
  reviewConcurrency: number;
  // Large reviews (>300 files / >30k diff) hand off to internal-cli, which
  // clones the repo and runs claude-cli — that's slower than an in-process
  // review, so it gets a longer timeout.
  largeReviewTimeoutSeconds: number;
}

export const QUEUE_CONFIG_DEFAULTS: QueueConfig = {
  reviewTimeoutSeconds: 900,
  reviewConcurrency: 2,
  largeReviewTimeoutSeconds: 1800,
};

// Buffer added on top of reviewTimeoutSeconds to decide when an in-flight
// review is "stuck" and can be claimed by another worker. Must exceed the
// pg-boss job timeout so we don't race with a still-running worker that
// pg-boss is about to kill.
export const STALE_RECLAIM_BUFFER_SECONDS = 300;

export function computeStaleReclaimMs(reviewTimeoutSeconds: number): number {
  return (reviewTimeoutSeconds + STALE_RECLAIM_BUFFER_SECONDS) * 1000;
}

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

export async function loadQueueConfig(): Promise<QueueConfig> {
  try {
    const row = await prisma.systemConfig.findUnique({ where: { id: "singleton" } });
    const stored = (row?.queueConfig as Partial<QueueConfig>) ?? {};
    return { ...QUEUE_CONFIG_DEFAULTS, ...stored };
  } catch {
    return QUEUE_CONFIG_DEFAULTS;
  }
}

let started = false;

export async function startQueue(): Promise<PgBoss> {
  if (started) return getBoss();

  const boss = getBoss();
  await boss.start();
  started = true;

  const config = await loadQueueConfig();
  console.log(`[queue] Config: timeout=${config.reviewTimeoutSeconds}s, concurrency=${config.reviewConcurrency}`);

  // Create queues with retry/expiry config
  await boss.createQueue("welcome-email", {
    retryLimit: 3,
    expireInSeconds: 300, // 5 min timeout per attempt
  }).catch(() => {}); // ignore if already exists

  await boss.createQueue("process-review", {
    retryLimit: 2,
    expireInSeconds: config.reviewTimeoutSeconds,
  }).catch(() => {});

  // Large PRs (>30k diff or >300 files) are handed to the internal-cli worker
  // which clones the repo and runs claude-cli over the full git diff.
  await boss.createQueue("process-large-review", {
    retryLimit: 1,
    expireInSeconds: config.largeReviewTimeoutSeconds,
  }).catch(() => {});

  // internal-cli enqueues this back to the engine when it's done; the engine
  // worker then parses findings and posts the PR comment + inline review.
  await boss.createQueue("post-large-review-result", {
    retryLimit: 2,
    expireInSeconds: 300,
  }).catch(() => {});

  // Community-tier (no API key) async review pipeline.
  // Indexing can take minutes for first-touch repos, so the action enqueues
  // and polls; the worker indexes + reviews and writes the result back to
  // the CommunityReviewJob row. Retry once on transient failure.
  await boss.createQueue("community-review", {
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: 1800, // 30 min hard cap per attempt
  }).catch(() => {});

  // Only review-engine containers should register workers. Web containers
  // still need pg-boss started so they can enqueue jobs, but must not consume.
  // The flag must be set explicitly: a missing value is a misconfiguration,
  // not a silent default, so throw rather than pick a side for the operator.
  const flag = process.env.ENABLE_REVIEW_WORKERS;
  if (flag !== "true" && flag !== "false") {
    throw new Error(
      "ENABLE_REVIEW_WORKERS must be set to \"true\" (review-engine replicas) or \"false\" (web replicas). See .env.example.",
    );
  }
  if (flag === "true") {
    const { registerWorkers } = await import("./queue-workers");
    await registerWorkers(boss, config);
  } else {
    console.log("[queue] ENABLE_REVIEW_WORKERS=false — enqueue-only mode, skipping worker registration");
  }

  console.log("[queue] pg-boss started");

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
