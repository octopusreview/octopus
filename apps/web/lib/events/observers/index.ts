import { registerSlackObserver } from "./slack.observer";
import { registerEmailObserver } from "./email.observer";

let initialized = false;

export function initializeObservers(): void {
  if (initialized) return;
  initialized = true;

  console.log("[event-bus] Initializing observers");
  registerSlackObserver();
  registerEmailObserver();
}
