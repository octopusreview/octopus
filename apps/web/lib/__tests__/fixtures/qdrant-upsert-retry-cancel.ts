import { mock } from "bun:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const scenario = process.argv[2];
assert.ok(["during-request", "during-backoff", "after-success", "sparse-abort", "sparse-retry-cancel", "sparse-success", "normal-retry", "signal-retry", "normal-error", "pre-aborted"].includes(scenario));
const controller = new AbortController();
const reason = scenario === "sparse-abort" ? new Error("Bad Request") : new DOMException("synthetic deadline", "TimeoutError");
let entered!: () => void;
const firstEntered = new Promise<void>((resolve) => { entered = resolve; });
let release!: () => void;
const released = new Promise<void>((resolve) => { release = resolve; });
const requests: unknown[] = [];
mock.module("server-only", () => ({}));
mock.module("@/lib/repository-index-storage", () => ({
  getRepositoryIndexGeneration: async (owner: { signal?: AbortSignal }) => { owner.signal?.throwIfAborted(); return "synthetic-generation"; },
  repositoryCodeStorageId: (repo: string, generation: string) => JSON.stringify([repo, generation]),
}));
mock.module("@qdrant/js-client-rest", () => ({
  QdrantClient: class {
    async upsert(_collection: string, args: { points: unknown[] }) {
      requests.push(args.points);
      if (requests.length === 1) {
        entered();
        if (scenario === "during-request") { await released; throw new TypeError("fetch failed"); }
        if (scenario === "during-backoff" || scenario === "normal-retry" || scenario === "signal-retry") throw new TypeError("fetch failed");
        if (scenario === "normal-error") throw new Error("synthetic permanent failure");
        if (scenario === "sparse-abort") { controller.abort(reason); throw new Error("sparse vector unavailable"); }
        if (scenario === "sparse-success" || scenario === "sparse-retry-cancel") throw new Error("sparse vector unavailable");
        if (scenario === "after-success") controller.abort(reason);
      }
      if (scenario === "sparse-retry-cancel" && requests.length === 2) throw new TypeError("fetch failed");
      return { status: "completed" };
    }
  },
  QdrantClientTimeoutError: class extends Error {},
}));
const originalWarn = console.warn;
console.warn = () => { if (scenario === "during-backoff" || (scenario === "sparse-retry-cancel" && requests.length === 2)) setTimeout(() => controller.abort(reason), 10); };
try {
  const { upsertChunks } = await import("@/lib/qdrant");
  if (scenario === "pre-aborted") controller.abort(reason);
  const owner = { repoId: "synthetic", indexAttemptId: "synthetic", ...(scenario === "normal-retry" || scenario === "normal-error" ? {} : { signal: controller.signal }) };
  const result = upsertChunks([{ id: "synthetic", vector: [0.1], sparseVector: { indices: [1], values: [1] }, payload: { repoId: "synthetic" } }], owner)
    .then(() => ({ ok: true }), (error) => ({ error }));
  if (scenario === "during-request") {
    await firstEntered;
    controller.abort(reason);
    assert.equal(await Promise.race([result, delay(50).then(() => "pending")]), "pending");
    release();
  }
  const limit = scenario === "during-backoff" || scenario === "sparse-retry-cancel" ? 350 : 3000;
  const outcome = await Promise.race([result, delay(limit, undefined, { ref: false }).then(() => "timed-out")]);
  assert.ok(typeof outcome === "object");
  if (["during-request", "during-backoff", "after-success", "sparse-abort", "sparse-retry-cancel", "pre-aborted"].includes(scenario)) {
    assert.ok("error" in outcome);
    assert.equal(outcome.error, reason);
    assert.equal(requests.length, scenario === "pre-aborted" ? 0 : scenario === "sparse-retry-cancel" ? 2 : 1);
    if (scenario === "during-backoff" || scenario === "sparse-retry-cancel") {
      await delay(650);
      assert.equal(requests.length, scenario === "sparse-retry-cancel" ? 2 : 1);
    }
  } else if (scenario === "normal-error") {
    assert.ok("error" in outcome);
    assert.match(String(outcome.error), /synthetic permanent failure/);
    assert.equal(requests.length, 1);
  } else {
    assert.deepEqual(outcome, { ok: true });
    assert.equal(requests.length, 2);
    if (scenario === "sparse-success") {
      const first = requests[0] as { vector: unknown }[];
      const second = requests[1] as { vector: unknown }[];
      assert.equal(Array.isArray(first[0].vector), false);
      assert.equal(Array.isArray(second[0].vector), true);
    }
  }
} finally { release(); console.warn = originalWarn; }
