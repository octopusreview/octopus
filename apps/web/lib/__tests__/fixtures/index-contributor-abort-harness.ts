import { mock } from "bun:test";
import "./index-github-rate-mocks";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

mock.module("server-only", () => ({}));
mock.module("@octopus/db", () => ({ prisma: {}, Prisma: {} }));
mock.module("@/lib/github", () => ({
  getInstallationToken: async () => "fixture",
  getFileContent: async () => null,
  getRepositoryDetails: async () => null,
}));
let collections = 0;
mock.module("@/lib/qdrant", () => ({
  ensureCollection: async () => { collections++; },
  upsertChunks: async () => {},
  deleteRepoFileChunks: async () => {},
}));
let entered!: () => void;
let release!: () => void;
const started = new Promise<void>(resolve => { entered = resolve; });
let stalled = true;
let signalSeen: AbortSignal | null | undefined;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
  if (path.includes("/git/trees/")) return Promise.resolve(Response.json({ tree: [] }));
  if (path.endsWith("/contributors")) {
    if (!stalled) return Promise.resolve(Response.json([{ login: "fixture", avatar_url: "", contributions: 1 }]));
    signalSeen = init?.signal;
    entered();
    return new Promise<Response>((resolve, reject) => {
      release = () => resolve(Response.json([]));
      if (init?.signal?.aborted) reject(init.signal.reason);
      else init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    });
  }
  throw new Error("Unexpected fixture fetch");
}) as typeof fetch;
const { indexRepository } = await import("@/lib/indexer");
const controller = new AbortController();
const index = (signal?: AbortSignal) => indexRepository(
  { repoId: "synthetic", indexAttemptId: "synthetic" }, "fixture/repo", "main", 1,
  undefined, signal, "github", "synthetic", "fixture",
);
const result = index(controller.signal).then(() => "returned", () => "rejected");
try {
  await started;
  controller.abort();
  assert.equal(await Promise.race([result, delay(500).then(() => "pending")]), "rejected");
  assert.equal(signalSeen?.aborted, true);
  assert.equal(signalSeen?.reason, controller.signal.reason);
  assert.equal(collections, 0, "cancelled indexing must not proceed to storage");
} finally {
  release?.();
  await result;
}
stalled = false;
const stats = await index(new AbortController().signal);
assert.equal(stats.contributorCount, 1);
assert.equal(stats.indexedFiles, 0);
assert.equal(collections, 1);
