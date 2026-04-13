import { EventEmitter } from "node:events";
import type { AppEvent, AppEventType } from "./types";

class EventBus {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(50);
  }

  emit(event: AppEvent): void {
    if (process.env.NODE_ENV !== "production") {
      const listenerCount = this.emitter.listenerCount(event.type);
      console.log(`[event-bus] emit "${event.type}" → ${listenerCount} listener(s)`);
    }
    this.emitter.emit(event.type, event);
  }

  on<T extends AppEvent>(
    type: T["type"],
    listener: (event: T) => void | Promise<void>,
  ): void {
    this.emitter.on(type, (event: T) => {
      try {
        const result = listener(event);
        if (result instanceof Promise) {
          result.catch((err) =>
            console.error(`[event-bus] Observer error on "${type}":`, err),
          );
        }
      } catch (err) {
        console.error(`[event-bus] Observer error on "${type}":`, err);
      }
    });
  }

  off(type: AppEventType, listener: (...args: unknown[]) => void): void {
    this.emitter.off(type, listener);
  }
}

// globalThis cache to survive Next.js HMR in dev
const globalForEventBus = globalThis as unknown as { eventBus?: EventBus };

export const eventBus = globalForEventBus.eventBus ?? new EventBus();

if (process.env.NODE_ENV !== "production") {
  globalForEventBus.eventBus = eventBus;
}

// Auto-initialize observers on first import (sync to avoid race conditions)
import { initializeObservers } from "./observers";
initializeObservers();
