import { registerSlackObserver } from "./slack.observer";
import { registerEmailObserver } from "./email.observer";
import { registerAuditObserver } from "./audit.observer";

// Use globalThis so the flag survives Next.js HMR (module re-evaluation resets module-level vars,
// but globalThis persists — same as the EventBus instance in bus.ts).
const globalForObservers = globalThis as unknown as { observersInitialized?: boolean };

export function initializeObservers(): void {
  if (globalForObservers.observersInitialized) return;
  globalForObservers.observersInitialized = true;

  console.log("[event-bus] Initializing observers");
  registerSlackObserver();
  registerEmailObserver();
  registerAuditObserver();
}
