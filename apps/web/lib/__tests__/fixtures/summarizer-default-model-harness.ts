import assert from "node:assert/strict";
import { mock } from "bun:test";

const models: string[] = [];
mock.module("@octopus/db", () => ({ prisma: { availableModel: { findFirst: async () => null } } }));
mock.module("@/lib/qdrant", () => ({ getRepoChunks: async () => ["export const answer = 42;"] }));
mock.module("@/lib/ai-usage", () => ({ logAiUsage: async () => {} }));
mock.module("@/lib/cost", () => ({ isOrgOverSpendLimit: async () => false }));
mock.module("@/lib/ai-router", () => ({
  createAiMessage: async ({ model }: { model: string }) => {
    models.push(model);
    return { text: '{"purpose": "p", "summary": "s"}', provider: "anthropic", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  },
}));

const { HARDCODED_REVIEW_MODEL } = await import("@/lib/ai-client");
const { summarizeRepository } = await import("@/lib/summarizer");

// No organization: the summarizer cannot resolve a per-org model and uses its fallback.
await summarizeRepository("repo_1", "team/repo");
// claude-sonnet-4-20250514 was retired by Anthropic on 2026-06-15.
assert.notEqual(models[0], "claude-sonnet-4-20250514");
assert.equal(models[0], HARDCODED_REVIEW_MODEL);
console.log("summarizer default model checks passed");
