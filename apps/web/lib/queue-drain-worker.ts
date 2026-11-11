import type { PgBoss } from "pg-boss";

// Loaded on first use: queue-workers.ts imports this file, and callers that only
// register workers (scripts, test harnesses) must not need the database client.
const lib = () => import("./queue-drain");

// Fencing rule: this process may hold queue worker registrations only while
// its last read of the drain row said "claiming".

let boss: Pick<PgBoss, "offWork"> | undefined;
let register: (() => Promise<string[]>) | undefined;
let pollMs = 0; // set by startQueueDrainWorker
let timer: ReturnType<typeof setInterval> | undefined;
let instanceId: string | undefined;
let held: string[] | undefined; // queue names while this process holds registrations
let stopping: Promise<void> | undefined; // in-flight handlers finishing after a drain was seen
let draining = false; // the last read of the drain row
let acked: number | undefined;
let polledAt = 0;
let polling = false;
let retiring = false;
let inlineActive = 0;

const logFailure = (what: string, error: unknown) =>
  console.error(`[queue] ${what} failed:`, error instanceof Error ? error.name : "unknown error");

async function poll(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const { acknowledgeDrain, expireDrainLease, heartbeat, registerInstance } = await lib();
    instanceId ??= await registerInstance();
    let drain = await heartbeat(instanceId, { inlineActive });
    // If whoever requested the drain stopped renewing it, resume without them.
    if (drain.state === "draining" && await expireDrainLease()) drain = { ...drain, state: "claiming" };
    draining = drain.state === "draining";
    polledAt = Date.now();
    if (draining) {
      if (held) {
        const queues = held;
        held = undefined;
        console.log(`[queue] Drain ${drain.generation} requested, waiting for active jobs...`);
        stopping = Promise.all(queues.map(name => boss!.offWork(name, { wait: true })))
          .catch(error => logFailure("Stopping workers", error))
          .then(() => { stopping = undefined; void poll(); });
      }
      // Only once every in-flight handler has finished.
      if (!stopping && acked !== drain.generation) {
        await acknowledgeDrain(instanceId, drain.generation);
        acked = drain.generation;
        console.log(`[queue] Drain ${drain.generation} acknowledged`);
      }
    } else if (register && !held && !stopping && !retiring) {
      held = await register();
      if (acked !== undefined) console.log("[queue] Drain ended, claiming again");
    }
  } catch (error) {
    // Keep the last known state; the next tick tries again.
    logFailure("Drain poll", error);
  } finally {
    polling = false;
  }
}

/**
 * Register this process and follow the drain row from now on. `registerWorkers`
 * returns the queue names it registered; enqueue-only processes omit it. The
 * drain row is read before any worker is registered, so a process started
 * mid-drain does not claim.
 */
export async function startQueueDrainWorker(
  queue: Pick<PgBoss, "offWork">, registerWorkers?: () => Promise<string[]>, intervalMs?: number,
): Promise<void> {
  boss = queue;
  register = registerWorkers;
  pollMs = intervalMs ?? (await lib()).HEARTBEAT_INTERVAL_SECONDS * 1000;
  await poll();
  timer = setInterval(() => void poll(), pollMs);
  timer.unref?.();
}

/**
 * Work done inside a web request rather than a queue job: CLI and Action reviews,
 * and detached indexing or analysis. It is never refused; a drain and a shutdown wait for it.
 */
export async function trackInline<T>(work: () => Promise<T>): Promise<T> {
  // Report the first one at once rather than on the next tick, so status does not miss it.
  if (inlineActive++ === 0 && instanceId) void poll();
  try {
    return await work();
  } finally {
    inlineActive--;
  }
}

/**
 * Shutdown: a later resume must not reopen a worker that is being removed.
 * Next waits for open requests itself; the wait here covers detached inline work.
 */
export async function retireQueueDrainWorker(timeoutMs: number): Promise<void> {
  retiring = true;
  clearInterval(timer);
  const id = instanceId;
  if (id) await lib().then(({ markRetiring }) => markRetiring(id)).catch(error => logFailure("Marking the instance as retiring", error));
  const deadline = Date.now() + timeoutMs;
  while (inlineActive > 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
}

// Refusing a job means throwing, which fails it. This queue has no retries
// and its failure is not recovered elsewhere, so it is worked regardless.
const NO_BACKSTOP = new Set(["pull-ollama-model"]);

/**
 * Backstop for a process that was frozen and woke up late: it may fetch a job
 * before its next poll. Throwing hands the job back through pg-boss's own
 * fenced failure path, at the cost of one retry. restore() would keep the retry
 * but leaves this handler's settlement able to hit the next claim.
 */
async function refuseWhileDraining(name: string): Promise<void> {
  if (!instanceId || NO_BACKSTOP.has(name)) return;
  // A read this old no longer proves anything: the drain may have completed without this process.
  if (Date.now() - polledAt > 3 * pollMs) {
    try {
      draining = (await (await lib()).heartbeat(instanceId, { inlineActive })).state === "draining";
      polledAt = Date.now();
    } catch (error) {
      logFailure("Drain read", error);
    }
  }
  if (draining) throw new Error("Queue is draining; the job was not started");
}

/** `boss.work` with the backstop in front of every handler; `queues` collects the names registered. */
export function fenceWorkers(queue: Pick<PgBoss, "work">): { work: PgBoss["work"]; queues: string[] } {
  const queues: string[] = [];
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
