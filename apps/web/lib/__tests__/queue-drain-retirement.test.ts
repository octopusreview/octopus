import { expect, it, mock } from "bun:test";

let stalled: "mark" | "heartbeat" | undefined;
let heartbeats = 0;
const never = () => new Promise<never>(() => {});
mock.module("../queue-drain", () => ({
  markRetiring: () => stalled === "mark" ? never() : Promise.resolve(),
  heartbeat: () => {
    heartbeats++;
    return stalled === "heartbeat" ? never() : Promise.resolve({ state: "claiming" });
  },
}));

const worker = await import("../queue-drain-worker");
const state = (globalThis as unknown as { queueDrainWorker: { instanceId: string; inlineActive: number } }).queueDrainWorker;
state.instanceId = "test";

for (const [operation, inlineActive] of [["mark", 0], ["heartbeat", 1], ["heartbeat", 0]] as const) {
  it(`bounds a stalled ${operation} write with ${inlineActive} inline work`, async () => {
    stalled = operation;
    state.inlineActive = inlineActive;
    const start = performance.now();
    await worker.retireQueueDrainWorker(40);
    expect(performance.now() - start).toBeLessThan(1000);
  });
}

it("waits for inline work and reports completion when writes succeed", async () => {
  stalled = undefined;
  state.inlineActive = 1;
  heartbeats = 0;
  setTimeout(() => { state.inlineActive = 0; }, 20);
  await worker.retireQueueDrainWorker(1000);
  expect(state.inlineActive).toBe(0);
  expect(heartbeats).toBe(2);
});
