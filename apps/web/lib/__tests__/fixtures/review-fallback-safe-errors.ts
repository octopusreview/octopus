import { mock } from "bun:test";
import assert from "node:assert/strict";

mock.module("server-only", () => ({}));
let scenario = "feedback";
let calls = 0;
const secret = "synthetic-secret-request-id";
let wrappedFailure: Error;
const failure = () => scenario === "wrapped" ? wrappedFailure : Object.assign(new Error(secret), { status: 503, request_id: secret });
const finding = { severity: "🟠", title: "Missing check", filePath: "src/a.ts", startLine: 1, endLine: 1, category: "Bug", description: "Missing check", suggestion: "", confidence: 95 };
const org = { id: "org", type: 1, defaultReviewConfig: {}, reviewLanguage: "en", creditBalance: 0, freeCreditBalance: 0, monthlySpendLimitUsd: null, anthropicApiKey: null, openaiApiKey: null, googleApiKey: null };
mock.module("@octopus/db", () => ({ prisma: {
  repository: { findUnique: async () => ({ id: "repo", fullName: "example/repo", organization: org, reviewConfig: {} }) },
  systemConfig: { findUnique: async () => null },
  reviewIssue: { findMany: async () => { if (scenario === "feedback") throw failure(); return []; } },
  organization: { findUnique: async () => org },
} }));
mock.module("@/lib/qdrant", () => ({ searchSimilarChunks: async () => [], searchKnowledgeChunks: async () => [], searchReviewChunks: async () => [] }));
mock.module("@/lib/embeddings", () => ({ createEmbeddings: async () => [[1]] }));
mock.module("@/lib/reranker", () => ({ rerankDocuments: async () => [] }));
mock.module("@/lib/knowledge-context", () => ({ getAlwaysIncludeKnowledge: async () => [], mergeKnowledgeChunks: () => [] }));
mock.module("@/lib/feedback-suppression", () => ({ suppressFindingsFromFeedback: async (items: unknown[]) => items }));
mock.module("@/lib/review-routing", () => ({ resolveReviewModel: async () => "fixture-model" }));
mock.module("@/lib/ai-client", () => ({ getReviewModel: async () => "fixture-model" }));
mock.module("@/lib/ai-usage", () => ({ logAiUsage: async (input: { operation: string }) => { if (scenario === "usage" && input.operation === "local-review-findings-followup") throw failure(); } }));
mock.module("@/lib/ai-router", () => ({
  getProviderForModel: async () => { throw failure(); },
  createAiMessage: async () => {
    calls++;
    if (calls === 2 && (scenario === "followup" || scenario === "wrapped")) throw failure();
    const count = scenario === "followup" || scenario === "wrapped" || scenario === "usage" ? 2 : 1;
    return { provider: "fixture", text: `Summary\n| 🟠 High | ${count} |\n<!-- OCTOPUS_FINDINGS_START -->\n${JSON.stringify([finding])}\n<!-- OCTOPUS_FINDINGS_END -->`, usage: { inputTokens: 1, outputTokens: 1 } };
  },
}));
mock.module("@/lib/review-validation", () => ({
  gatherCrossFileContext: async () => "", gatherVerificationContext: async () => new Map(),
  validateFindings: async (items: unknown[]) => { if (scenario === "validation") throw failure(); return items; },
}));

const { generateLocalReview } = await import("@/lib/review-core");
const { getOrgSpendLimitStatus } = await import("@/lib/cost");
const { AiProviderFailure } = await import("@/lib/provider-failure");
wrappedFailure = new AiProviderFailure(Object.assign(new Error(secret), { status: 503, request_id: secret }), "openai", "fixture", "platform");
const logs: unknown[][] = [];
const warn = console.warn, error = console.error;
console.warn = console.error = (...args: unknown[]) => { logs.push(args); };
try {
  for (scenario of ["feedback", "followup", "wrapped", "usage", "validation"]) {
    calls = 0;
    const before = logs.length;
    const result = await generateLocalReview({ diff: "diff --git a/src/a.ts b/src/a.ts\n+change", repoId: "repo", orgId: "org" });
    assert.equal(result.findings.length, 1, `${scenario} retains the original finding`);
    const entry = logs.slice(before).find(row => String(row[0]).includes(scenario === "feedback" ? "Failed to fetch feedback" : scenario === "validation" ? "Two-pass validation failed" : "Follow-up findings call failed"));
    assert.ok(entry, `${scenario} logs the fallback`);
    assert.deepEqual(entry[1], { name: "Error", status: 503 });
  }
  assert.deepEqual(await getOrgSpendLimitStatus("org", "repo"), { blocked: true, reason: "no_credits" });
  assert.deepEqual(logs.at(-1)?.[1], { name: "Error", status: 503 });
  Object.assign(org, { anthropicApiKey: "a", openaiApiKey: "b", googleApiKey: "c" });
  assert.deepEqual(await getOrgSpendLimitStatus("org", "repo"), { blocked: false });
  assert.equal(JSON.stringify(logs).includes(secret), false);
} finally { console.warn = warn; console.error = error; }
