import type { PgBoss } from "pg-boss";

// Below the review-engine's 360s stop grace period.
const DRAIN_TIMEOUT_MS = 300_000;

/**
 * On SIGTERM/SIGINT, keep the process alive until in-flight queue jobs finish.
 *
 * Next's own signal handler closes the HTTP server and then calls
 * process.exit() at once, which killed jobs mid-review. That exit is held back
 * until the queue has stopped, so Next still closes HTTP gracefully and its
 * exit code is kept.
 */
export function installQueueShutdown(boss: Pick<PgBoss, "stop">, timeout = DRAIN_TIMEOUT_MS): void {
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("[queue] Graceful shutdown, waiting for active jobs...");
    const exit = process.exit.bind(process);
    let held: { code?: number | string | null } | undefined;
    process.exit = ((code?: number | string | null) => { held = { code }; }) as typeof process.exit;
    try {
      await boss.stop({ graceful: true, timeout });
    } catch (error) {
      console.error("[queue] Graceful shutdown failed:", error instanceof Error ? error.name : "unknown error");
    }
    process.exit = exit;
    // Next exits by itself once HTTP has closed. Where this is the only handler
    // (NEXT_MANUAL_SIG_HANDLE, or a process that is not a Next server) nothing else will.
    if (held) exit(held.code);
    else if (process.listenerCount(signal) <= 1) exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
