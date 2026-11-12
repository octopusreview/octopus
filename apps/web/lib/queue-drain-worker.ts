import type { PgBoss } from "pg-boss";

// Loaded on first use: queue-workers.ts imports this file, and callers that only
// register workers (scripts, test harnesses) must not need the database client.
const lib = () => import("./queue-drain");

// Fencing rule: this process may hold queue worker registrations only while
// its last read of the drain row said "claiming".

// Kept on globalThis like the pg-boss instance: Next can load this module more than once
// (instrumentation and route handlers), and inline work must be counted by the copy that polls.
const s = ((globalThis as unknown as { queueDrainWorker?: {
  boss?: Pick<PgBoss, "offWork">;
  register?: (queues: string[]) => Promise<void>;
  pollMs: number; // set by startQueueDrainWorker
  timer?: ReturnType<typeof setInterval>;
  instanceId?: string;
  held?: string[]; // queue names while this process holds registrations
  registrationFailed: boolean;
  stopping?: Promise<void>; // in-flight handlers finishing after a drain was seen
  draining: boolean; // the last read of the drain row
  acked?: number;
  polledAt: number;
  polling: boolean;
  retiring: boolean;
  inlineActive: number;
} }).queueDrainWorker ??= { pollMs: 0, registrationFailed: false, draining: false, polledAt: 0, polling: false, retiring: false, inlineActive: 0 });

const logFailure = (what: string, error: unknown) =>
  console.error(`[queue] ${what} failed:`, error instanceof Error ? error.name : "unknown error");

const report = () => lib().then(({ heartbeat }) => heartbeat(s.instanceId!, { inlineActive: s.inlineActive }))
  .then(() => undefined, error => logFailure("Reporting inline work", error));

async function poll(): Promise<void> {
  if (s.polling) return;
  s.polling = true;
  try {
    const { acknowledgeDrain, expireDrainLease, heartbeat, registerInstance } = await lib();
    s.instanceId ??= await registerInstance();
    let drain = await heartbeat(s.instanceId, { inlineActive: s.inlineActive });
    // If whoever requested the drain stopped renewing it, resume without them.
    if (drain.state === "draining" && await expireDrainLease()) drain = { ...drain, state: "claiming" };
    s.draining = drain.state === "draining";
    s.polledAt = Date.now();
    if (s.held && (s.draining || s.registrationFailed) && !s.stopping) {
      const queues = s.held;
      console.log(`[queue] Stopping workers, waiting for active jobs...`);
      s.stopping = Promise.allSettled(queues.map(name => Promise.resolve().then(() => s.boss!.offWork(name, { wait: true }))))
        .then(results => {
          s.held = queues.filter((_, index) => results[index].status === "rejected");
          for (const result of results) if (result.status === "rejected") logFailure("Stopping workers", result.reason);
          if (s.held.length === 0) { s.held = undefined; s.registrationFailed = false; }
          s.stopping = undefined;
          if (!s.held) void poll();
        });
    }
    if (s.draining) {
      // Only once every in-flight handler has finished.
      if (!s.held && !s.stopping && s.acked !== drain.generation) {
        await acknowledgeDrain(s.instanceId, drain.generation);
        s.acked = drain.generation;
        console.log(`[queue] Drain ${drain.generation} acknowledged`);
      }
    } else if (s.register && !s.held && !s.stopping && !s.retiring) {
      s.held = [];
      try { await s.register(s.held); } catch (error) { s.registrationFailed = true; throw error; }
      if (s.acked !== undefined) console.log("[queue] Drain ended, claiming again");
    }
  } catch (error) {
    // Keep the last known state; the next tick tries again.
    logFailure("Drain poll", error);
  } finally {
    s.polling = false;
  }
}

/**
 * Register this process and follow the drain row from now on. `registerWorkers`
 * returns the queue names it registered; enqueue-only processes omit it. The
 * drain row is read before any worker is registered, so a process started
 * mid-drain does not claim.
 */
export async function startQueueDrainWorker(
  queue: Pick<PgBoss, "offWork">, registerWorkers?: (queues: string[]) => Promise<void>, intervalMs?: number,
): Promise<void> {
  s.boss = queue;
  s.register = registerWorkers;
  s.pollMs = intervalMs ?? (await lib()).HEARTBEAT_INTERVAL_SECONDS * 1000;
  await poll();
  s.timer = setInterval(() => void poll(), s.pollMs);
  s.timer.unref?.();
}

/**
 * Work done inside a web request rather than a queue job: CLI and Action reviews,
 * and detached indexing or analysis. It is never refused; a drain and a shutdown wait for it.
 */
export async function trackInline<T>(work: () => Promise<T>): Promise<T> {
  s.inlineActive++;
  try {
    // During a drain the count is written before the work starts, so status cannot miss it.
    // Otherwise report the first one at once rather than on the next tick.
    if (s.instanceId && s.draining) await report();
    else if (s.instanceId && s.inlineActive === 1) void poll();
    return await work();
  } finally {
    s.inlineActive--;
  }
}

/**
 * Shutdown: a later resume must not reopen a worker that is being removed.
 * Next waits for open requests itself; the wait here covers detached inline work.
 */
export async function retireQueueDrainWorker(timeoutMs: number): Promise<void> {
  s.retiring = true;
  clearInterval(s.timer);
  const id = s.instanceId;
  const deadline = Date.now() + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        if (id) await lib().then(({ markRetiring }) => markRetiring(id)).catch(error => logFailure("Marking the instance as retiring", error));
        for (let tick = 0; s.inlineActive > 0 && Date.now() < deadline; tick++) {
          if (id && tick % 10 === 0) await report();
          if (Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, Math.min(100, deadline - Date.now())));
        }
        if (id && Date.now() < deadline) await report();
      })(),
      new Promise<void>(resolve => { timer = setTimeout(resolve, Math.max(0, deadline - Date.now())); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Refusing a job means throwing, which fails it. This queue has no retries
// and its failure is not recovered elsewhere, so it is worked regardless.
const NO_BACKSTOP = new Set(["pull-ollama-model"]);

/**
 * Backstop for a process that was frozen and woke up late: it may fetch a job
 * before its next poll. Throwing hands the job back through pg-boss's own
 * fenced failure path, at the cost of one retry. restore() would keep the retry
 * but leaves this handler's settlement able to hit the next claim.
 * shortcut: a refused job on its last attempt fails without running (a scheduled job waits for
 * its next run, a review for the stuck-review reaper); upgrade to a non-consuming deferral if
 * refusals show up in the logs.
 */
async function refuseWhileDraining(name: string): Promise<void> {
  if (!s.instanceId || NO_BACKSTOP.has(name)) return;
  // Status stops counting this process after three missed heartbeats, so a read older than two
  // no longer proves anything: the drain may have completed without it. If the read fails the last
  // known state stands: refusing would fail customer jobs whenever the database is briefly slow.
  if (Date.now() - s.polledAt > 2 * s.pollMs) {
    try {
      s.draining = (await (await lib()).heartbeat(s.instanceId, { inlineActive: s.inlineActive })).state === "draining";
      s.polledAt = Date.now();
    } catch (error) {
      logFailure("Drain read", error);
    }
  }
  if (s.draining) throw new Error("Queue is draining; the job was not started");
}

/** `boss.work` with the backstop in front of every handler; `queues` collects the names registered. */
export function fenceWorkers(queue: Pick<PgBoss, "work">, queues: string[] = []): { work: PgBoss["work"]; queues: string[] } {
  const work = ((name: string, ...args: unknown[]) => {
    const handler = args.pop() as (jobs: unknown) => Promise<unknown>;
    queues.push(name);
    return (queue.work as (...all: unknown[]) => Promise<string>).call(queue, name, ...args, async (jobs: unknown) => {
      await refuseWhileDraining(name);
      return handler(jobs);
    });
  }) as PgBoss["work"];
  return { work, queues };
}
