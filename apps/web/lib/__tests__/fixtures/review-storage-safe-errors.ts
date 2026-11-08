import { mock } from "bun:test";
import assert from "node:assert/strict";

const secret = "synthetic-secret-request-id";
let failUsage = true;
let usageWrites = 0;
let mode = "sparse";
const calls: string[] = [];
const failure = () => Object.assign(new Error(`sparse vector ${secret}`), { status: 400, request_id: secret });
mock.module("server-only", () => ({}));
mock.module("@octopus/db", () => ({ prisma: {
  organization: { findUnique: async () => ({}) },
  aiUsage: { create: async () => { usageWrites++; if (failUsage) throw failure(); return { id: "usage" }; } },
  auditLog: { create: async () => { throw failure(); } },
} }));
mock.module("@/lib/cost", () => ({ calcCost: () => 0, getModelPricing: async () => new Map() }));
mock.module("@/lib/credits", () => ({ deductCredits: async () => { throw new Error("unexpected deduction"); } }));
mock.module("@/lib/repository-index-storage", () => ({ getActiveRepositoryCodeFilter: async () => ({ must: [] }) }));
mock.module("@qdrant/js-client-rest", () => ({
  QdrantClient: class {
    async query(collection: string) {
      calls.push(`query:${collection}`);
      if (mode === "sparse") throw failure();
      if (mode === "other") throw new Error("other storage failure");
      return { points: [{ payload: { text: "found" }, score: 0.9 }] };
    }
    async search(collection: string) {
      calls.push(`search:${collection}`);
      return [{ payload: { text: "found" }, score: 0.9 }];
    }
  },
  QdrantClientTimeoutError: class extends Error {},
}));
const { logAiUsage } = await import("@/lib/ai-usage");
const { writeAuditLog } = await import("@/lib/audit");
const { searchSimilarChunks, searchKnowledgeChunks, searchReviewChunks } = await import("@/lib/qdrant");
const logs: unknown[][] = [];
const warn = console.warn, error = console.error;
console.warn = console.error = (...args: unknown[]) => { logs.push(args); };
try {
  const usage = { provider: "mock" as const, model: "fixture", operation: "local-review", inputTokens: 1, outputTokens: 1, organizationId: "org" };
  assert.equal(await logAiUsage(usage), undefined);
  assert.equal(usageWrites, 1);
  assert.deepEqual(logs.at(-1)?.[1], { name: "Error", status: 400 });
  failUsage = false;
  assert.equal(await logAiUsage(usage), undefined);
  assert.equal(usageWrites, 2);
  assert.equal(await writeAuditLog({ action: "repo.analyzed", category: "repo" }), undefined);
  assert.deepEqual(logs.at(-1)?.[1], { name: "Error", status: 400 });
  const searches = [
    () => searchSimilarChunks("repo", [1], 10, "text"),
    () => searchKnowledgeChunks("org", [1], 10, "text"),
    () => searchReviewChunks("org", [1], 10, "text"),
  ];
  for (const search of searches) {
    const before = calls.length;
    assert.equal((await search())[0].text, "found");
    assert.deepEqual(calls.slice(before).map(call => call.split(":")[0]), ["query", "search"]);
    assert.deepEqual((logs.at(-1)?.[1] as { error: unknown }).error, { name: "Error", status: 400 });
    mode = "other";
    await assert.rejects(search(), /other storage failure/);
    mode = "success";
    const successBefore = calls.length;
    assert.equal((await search())[0].text, "found");
    assert.deepEqual(calls.slice(successBefore).map(call => call.split(":")[0]), ["query"]);
    mode = "sparse";
  }
  assert.equal(JSON.stringify(logs).includes(secret), false);
} finally { console.warn = warn; console.error = error; }
