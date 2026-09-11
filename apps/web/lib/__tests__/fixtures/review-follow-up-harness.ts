import { mock } from "bun:test";
import assert from "node:assert/strict";
import type { AiCreateParams } from "@/lib/providers";
import type { ReviewCoverage } from "@/lib/review-coverage";
mock.module("server-only", () => ({}));
let prior: ReviewCoverage | null = null;
let lookupFailure = false;
let received: { messages: { role: string; content: string }[] };
let malformed = false;
class FakeOpenAI {
  chat = { completions: { create: async (request: typeof received) => {
    received = request;
    return { model: "gpt-fixture", choices: [{ finish_reason: "stop", message: { content: malformed ? "Malformed response" : report } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
  } } };
}
mock.module("openai", () => ({ default: FakeOpenAI }));
const finding = {
  severity: "🟠", title: "Missing null check", filePath: "src/check.ts", startLine: 1, endLine: 1,
  category: "Bug", description: "A missing value causes this access to throw.", suggestion: "", confidence: 95,
};
const diff = "diff --git a/src/check.ts b/src/check.ts\n--- a/src/check.ts\n+++ b/src/check.ts\n@@ -1 +1 @@\n-return value;\n+return value.name;\n";
const org = { id: "org", defaultReviewConfig: {}, reviewLanguage: "en" };
const repo = {
  id: "repo", fullName: "fixture/repo", organization: org, reviewConfig: {},
  provider: "github", installationId: 1, indexStatus: "indexed", defaultBranch: "main",
};
const pr = {
  id: "pr", repository: repo, number: 1, title: "Handle missing values", author: "fixture",
  headSha: "a".repeat(40), reviewRequestVersion: 2, status: "pending", reviewBody: null, reviewCoverage: null,
};
mock.module("@octopus/db", () => ({ prisma: {
  reviewAttempt: { findFirst: async (query: unknown) => {
    assert.deepEqual(query, { where: { pullRequestId: "pr" }, orderBy: { createdAt: "desc" }, select: { coverage: true } });
    if (lookupFailure) throw new Error("fixture lookup failure");
    return prior ? { coverage: prior } : null;
  } },
  repository: { findUnique: async () => repo },
  systemConfig: { findUnique: async () => null },
  reviewIssue: { findMany: async () => [] },
  pullRequest: { findUnique: async () => pr, updateMany: async () => ({ count: 1 }) },
} }));
mock.module("@/lib/embeddings", () => ({ createEmbeddings: async (texts: string[]) => texts.map(() => [1, 0, 0]) }));
mock.module("@/lib/qdrant", () => ({
  searchSimilarChunks: async () => [], searchKnowledgeChunks: async () => [], searchReviewChunks: async () => [],
  searchFeedbackPatterns: async () => [], ensureFeedbackCollection: async () => {},
  ensureReviewCollection: async () => {}, upsertReviewChunks: async () => {}, deleteReviewChunksByPR: async () => {},
  ensureDiagramCollection: async () => {}, upsertDiagramChunk: async () => {}, deleteDiagramChunksByPR: async () => {},
  upsertFeedbackPattern: async () => {},
}));
mock.module("@/lib/reranker", () => ({ rerankDocuments: async () => [] }));
mock.module("@/lib/knowledge-context", () => ({ getAlwaysIncludeKnowledge: async () => [], mergeKnowledgeChunks: () => [] }));
mock.module("@/lib/review-routing", () => ({ resolveReviewModel: async () => "gpt-fixture" }));
mock.module("@/lib/ai-usage", () => ({ logAiUsage: async () => {} }));
mock.module("@/lib/ai-router", () => ({ createAiMessage: async (params: AiCreateParams) => {
  const { openaiProvider } = await import("@/lib/providers/openai");
  return openaiProvider.create(params, "fixture-key");
} }));
mock.module("@/lib/review-validation", () => ({
  gatherCrossFileContext: async () => "",
  gatherVerificationContext: async () => new Map(),
  validateFindings: async (findings: unknown[]) => findings,
}));

// Hosted review integration: keep generation, parsing, suppression and finding
// persistence mapping real; replace external services and unrelated prerequisites.
const archived: { findings: { title: string }[]; coverage: unknown; body: string }[] = [];
const summaries: string[] = [];
const published: { body: string; comments: unknown[] }[] = [];
mock.module("@/lib/review-attempt", () => ({
  createReviewAttemptComment: async (_id: string, _head: string, _version: number, create: () => Promise<number>) => create(),
  updateCurrentReview: async () => ({ count: 1 }),
  saveReviewAttempt: async (_id: string, _pr: string, _coverage: unknown, _body: string, findings: { title: string }[]) => {
    archived.push({ findings, coverage: _coverage, body: _body });
    return false; // Stop after persistence/publication, before unrelated timeline indexing.
  },
}));
mock.module("@/lib/github", () => ({
  LargePrError: class LargePrError extends Error {},
  getPullRequestReviewInput: async () => ({ rawDiff: diff, input: {
    provider: "github", headSha: pr.headSha, baseSha: "b".repeat(40), inventoryComplete: true,
    expectedFiles: 1, limitations: [],
    files: [{ path: "src/check.ts", change: "modified", patch: "@@ -1 +1 @@\n-return value;\n+return value.name;\n", additions: 1, deletions: 1 }],
  } }),
  getPullRequestDetails: async () => ({ body: "Handle missing values" }),
  createPullRequestComment: async () => 123,
  updatePullRequestComment: async (_installation: number, _owner: string, _repo: string, _id: number, body: string) => { summaries.push(body); },
  createPullRequestReview: async (_installation: number, _owner: string, _repo: string, _number: number, body: string, _event: string, comments: unknown[]) => {
    published.push({ body, comments });
    return 456;
  },
  createCheckRun: async () => 789,
  updateCheckRun: async () => {},
  getRepositoryTree: async () => ["src/check.ts"],
  getFileContent: async () => "return value.name;",
  listReviewComments: async () => [],
  listPullRequestReviewComments: async () => [{ id: 5, user: "fixture[bot]", path: "src/check.ts", line: 1, body: "🟠 Previous unrelated partial-review issue", inReplyToId: null }],
  listPullRequestIssueComments: async () => [],
  listPullRequestReviews: async () => [],
  getCommentReactions: async () => ({ thumbsUp: 0, thumbsDown: 0 }),
}));
mock.module("@/lib/bitbucket", () => ({}));
mock.module("@/lib/gitlab", () => ({}));
mock.module("@/lib/github-app-config", () => ({ getGithubAppConfig: async () => ({ slug: "fixture" }) }));
mock.module("@/lib/queue", () => ({
  loadQueueConfig: async () => ({ reviewTimeoutSeconds: 60, largeReviewTimeoutSeconds: 60 }),
  computeStaleReclaimMs: () => 120000,
  enqueue: async () => {}, enqueueAfter: async () => {},
}));
mock.module("@/lib/cost", () => ({ getOrgSpendLimitStatus: async () => ({ blocked: false }), shouldGuardConcurrency: async () => false }));
mock.module("@/lib/pubby", () => ({ pubby: { trigger: async () => {} } }));
mock.module("@/lib/events", () => ({ eventBus: { emit: () => {} } }));
mock.module("@/lib/indexer", () => ({ indexRepository: async () => { throw new Error("unexpected indexing"); } }));
mock.module("@/lib/review-repository-preparation", () => ({ ensureRepositoryAnalysis: async () => "ready", deferReviewForRepository: async () => {} }));
mock.module("@/lib/elasticsearch", () => ({ writeSyncLog: () => {}, deleteSyncLogs: async () => {} }));
mock.module("@/lib/repo-config", () => ({
  fetchRepoConfigFile: async () => null, extractRepoConfigRules: async () => null,
  buildRepoConfigUserBlock: () => "", normalizeRepoConfigFiles: () => [],
}));

const report = `## 🐙 Octopus Review
### Summary
The changed access needs a null check.
### Score
| Category | Score | Notes |
| --- | --- | --- |
| Security | 5/5 | No finding |
| Code Quality | 4/5 | Missing check |
| Performance | 5/5 | Bounded |
| Error Handling | 4/5 | Missing check |
| Consistency | 5/5 | Consistent |
| **Overall** | **4/5** | One finding |
### Findings Summary
| Severity | Count |
| --- | --- |
| 🟠 High | 1 |
### Findings
<!-- OCTOPUS_FINDINGS_START -->
${JSON.stringify([finding])}
<!-- OCTOPUS_FINDINGS_END -->`;
const { prepareReviewInput } = await import("@/lib/review-coverage");
const { canRestrictReviewToFollowUp } = await import("@/lib/review-follow-up");
const { processReview } = await import("@/lib/reviewer");
const current = prepareReviewInput({ provider: "github", headSha: pr.headSha, baseSha: "b".repeat(40), expectedFiles: 1, inventoryComplete: true, limitations: [], files: [
  { path: "src/check.ts", change: "modified", patch: "@@ -1 +1 @@\n-return value;\n+return value.name;\n", additions: 1, deletions: 1 },
] }, { maxChars: 350000 }).coverage;
current.reviewRequestVersion = 2;
// Build positive history from the real hosted assessment and adapter receipt.
await processReview("pr");
const recorded = archived.at(-1)!.coverage as ReviewCoverage;
assert.equal(recorded.assessment?.state, "completed");
const completed = (): ReviewCoverage => ({ ...structuredClone(recorded), reviewRequestVersion: 1 });
const omitted = completed(); omitted.complete = false; omitted.files[0].state = "omitted";
const malformedPrior = completed(); malformedPrior.assessment!.state = "incomplete";
const noModel = completed(); noModel.assessment!.state = "not-required";
const stale = completed(); stale.reviewRequestVersion = 0;
const sameVersion = completed(); sameVersion.reviewRequestVersion = 2;
const changedBase = completed(); changedBase.baseSha = "c".repeat(40);
const newlyEligible = completed(); newlyEligible.files[0].state = "excluded";
const missingPath = completed(); missingPath.files = [];
const legacy = { complete: true } as ReviewCoverage;
const missingHead = completed(); missingHead.headSha = null;
const contradictory = completed(); contradictory.files[0].state = "partial";
const incompleteInventory = completed(); incompleteInventory.inventoryComplete = false;
const interrupted = completed(); interrupted.assessment!.completion!.state = "incomplete";
const noCompletion = completed(); noCompletion.assessment!.completion = null;
const noRequests = completed(); noRequests.assessment!.requests = [];
const lostInput = completed(); lostInput.assessment!.requests[0].inputPreserved = false;
const wrongModel = completed(); wrongModel.assessment!.requests[0].model = "other-model";
const missingDigest = completed(); missingDigest.assessment!.responseSha256 = null;
for (const [name, value] of [
  ["omitted", omitted], ["malformed", malformedPrior], ["no-model", noModel], ["missing", null],
  ["stale", stale], ["same-version", sameVersion], ["changed-base", changedBase],
  ["newly-eligible", newlyEligible], ["missing-path", missingPath], ["legacy", legacy], ["missing-head", missingHead],
  ["contradictory", contradictory], ["incomplete-inventory", incompleteInventory],
  ["interrupted", interrupted], ["no-completion", noCompletion], ["no-requests", noRequests],
  ["lost-input", lostInput], ["wrong-model", wrongModel], ["missing-digest", missingDigest],
] as const) {
  prior = value;
  assert.equal(await canRestrictReviewToFollowUp("pr", current), false, name);
  const before = archived.length;
  const priorPublished = published.length;
  await processReview("pr");
  assert.equal(archived.length, before + 1, `${name}: hosted review reached persistence`);
  assert.deepEqual(archived.at(-1)!.findings.map(f => f.title), [finding.title], `${name}: high finding retained`);
  assert.equal(published.length, priorPublished + 1);
  assert.equal(published.at(-1)!.comments.length, 1, `${name}: new inline survives an old comment at the same location`);
  assert.equal((archived.at(-1)!.coverage as ReviewCoverage).assessment?.state, "completed", JSON.stringify(archived.at(-1)!.coverage));
  assert.equal((archived.at(-1)!.coverage as ReviewCoverage).complete, true, name);
  assert.equal((archived.at(-1)!.coverage as ReviewCoverage).assessment?.requests[0]?.inputPreserved, true);
  assert.ok(!received.messages[0].content.includes("RE-REVIEW MODE"), `${name}: actual provider prompt is a full assessment`);
  if (name === "omitted" && process.env.REVIEW_TEST_EVIDENCE_DIR) {
    const directory = process.env.REVIEW_TEST_EVIDENCE_DIR;
    await Bun.write(`${directory}/retry-publication.json`, JSON.stringify({ publication: published.at(-1), archived: archived.at(-1) }, null, 2));
    const publication = published.at(-1)!;
    const comments = publication.comments as { path: string; line: number; body: string }[];
    await Bun.write(`${directory}/retry-report.html`, '<!doctype html><meta charset="utf-8"><title>Fixture retry review</title>' +
      Bun.markdown.html([publication.body, ...comments.map(comment => `### ${comment.path}:${comment.line}\n\n${comment.body}`)].join("\n\n")));
  }
}
prior = completed();
assert.equal(await canRestrictReviewToFollowUp("pr", current), true);
assert.equal(await canRestrictReviewToFollowUp("pr", { ...current, complete: false }), false);
assert.equal(await canRestrictReviewToFollowUp("pr", { ...current, baseSha: null }), false);
assert.equal(await canRestrictReviewToFollowUp("pr", { ...current, reviewRequestVersion: undefined }), false);
await processReview("pr");
assert.deepEqual(archived.at(-1)!.findings, [], "completed follow-up keeps the existing severity policy");
assert.ok(received.messages[0].content.includes("RE-REVIEW MODE"));
// Lookup outages retain full assessment and keep the provider-output gate.
lookupFailure = true;
const warn = console.warn;
console.warn = () => {};
try {
  assert.equal(await canRestrictReviewToFollowUp("pr", current), false);
  await processReview("pr");
  assert.deepEqual(archived.at(-1)!.findings.map(f => f.title), [finding.title]);
  assert.equal(published.at(-1)!.comments.length, 1);
  malformed = true;
  await processReview("pr");
  assert.equal((archived.at(-1)!.coverage as ReviewCoverage).complete, false);
  assert.equal((archived.at(-1)!.coverage as ReviewCoverage).assessment?.state, "incomplete");
  if (process.env.REVIEW_TEST_EVIDENCE_DIR) {
    await Bun.write(`${process.env.REVIEW_TEST_EVIDENCE_DIR}/malformed-assessment.json`, JSON.stringify(archived.at(-1), null, 2));
  }
} finally { console.warn = warn; }
console.log("PASS incomplete retry findings, inline publication and assessment gates");
