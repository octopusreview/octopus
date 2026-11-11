// Child process for queue-shutdown.test.ts: the queue cannot be stopped when the signal arrives.
import { setTimeout as delay } from "node:timers/promises";
import { installQueueShutdown } from "../../queue-shutdown";

const error = new Error("synthetic-secret-connection-string");
installQueueShutdown({ stop: async () => { throw error; } });
if (process.argv[2] === "next") process.on("SIGTERM", () => { setTimeout(() => process.exit(143), 50); });
console.log("ready");
await delay(30_000);
process.exit(9);
