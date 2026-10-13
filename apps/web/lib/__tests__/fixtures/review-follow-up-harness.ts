import { mock } from "bun:test";
import assert from "node:assert/strict";
import type { AiCreateParams } from "@/lib/providers";
import { assertReviewProcessingActive, type ReviewExecutionWindow } from "@/lib/review-capacity";
import type { ReviewCoverage } from "@/lib/review-coverage";
mock.module("server-only", () => ({}));
const directCommentFailure = process.argv.includes("--direct-forgejo-comment-failure");
const preserveAutoReview = process.argv.includes("--preserve-auto-review");
const firstCompletion = process.argv.includes("--first-review-completion");
const approveCleanReviews = process.argv.includes("--approve-clean-reviews");
let completionFailure: "summary" | "check" | null = null;
const reviewUpdates: unknown[] = [];
let nativeFailure = false;
let forgejoConnector = false;
let preparationState: "ready" | "waiting" | "failure" = "ready";
const forgejoPublications: string[] = [];
let directComments = 0;
let prior: ReviewCoverage | null = null;
let lookupFailure = false;
let received: { messages: { role: string; content: string }[] };
let malformed = false;
let responseOverride: string | null = null;
let providerInterrupted = false;
let adaptiveStage: "before-validator" | "during-validator" | "expired-validator" | "after-save" | "summary-send" | "check-send" | "summary-timeout" | "gitlab-auth" | "transport-control" | "gitlab-transport-control" | null = null;
let adaptiveAbort = new AbortController();
let adaptiveRemaining = 900000;
let validatorCalls = 0;
let usageCount = 0;
const events: { type?: string; status?: string }[] = [];
let completedSnapshot: string | undefined;
globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
  assert.ok(init?.signal);
  await Promise.resolve();
  if (adaptiveStage === "transport-control") throw new Error("Unrelated transport error");
  if (adaptiveStage === "summary-timeout") {
    adaptiveRemaining = 0;
    throw new DOMException("Deadline elapsed", "TimeoutError");
  }
  adaptiveAbort.abort();
  init.signal.throwIfAborted();
  throw new Error("Expected aborted request");
}) as typeof fetch;
class FakeOpenAI {
  chat = { completions: { create: async (request: typeof received) => {
    received = request;
    if (providerInterrupted) throw new Error("fixture provider interrupted");
    return { model: "gpt-fixture", choices: [{ finish_reason: "stop", message: { content: responseOverride ?? (malformed ? "Malformed response" : report) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
  } } };
}
mock.module("openai", () => ({ default: FakeOpenAI }));
const finding = {
  severity: "🟠", title: "Missing null check", filePath: "src/check.ts", startLine: 1, endLine: 1,
  category: "Bug", description: "A missing value causes this access to throw.", suggestion: "", confidence: 95,
};
const diff = "diff --git a/src/check.ts b/src/check.ts\n--- a/src/check.ts\n+++ b/src/check.ts\n@@ -1 +1 @@\n-return value;\n+return value.name;\n";
const org = { id: "org", defaultReviewConfig: {}, reviewLanguage: "en", approveCleanReviews: false };
const repo = {
  id: "repo", fullName: "fixture/repo", organization: org, reviewConfig: {},
  provider: "github", installationId: 1, indexStatus: "indexed", defaultBranch: "main",
  organizationId: "org", autoReview: false,
};
const pr = {
  id: "pr", repository: repo, number: 1, title: "Handle missing values", author: "fixture",
  headSha: "a".repeat(40), reviewRequestVersion: 2, status: "pending", reviewBody: null as string | null, reviewCoverage: null,
  firstReviewCompletedAt: null as Date | null,
};
mock.module("@octopus/db", () => ({ prisma: {
  reviewAttempt: { findFirst: async (query: unknown) => {
    assert.deepEqual(query, { where: { pullRequestId: "pr" }, orderBy: { createdAt: "desc" }, select: { coverage: true } });
    if (lookupFailure) throw new Error("fixture lookup failure");
    return prior ? { coverage: prior } : null;
  } },
  repository: {
    findUnique: async () => repo,
    updateMany: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(repo, data); return { count: 1 }; },
    update: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(repo, data); return repo; },
  },
  systemConfig: { findUnique: async () => null },
  reviewIssue: { findMany: async () => [] },
  pullRequest: { findUnique: async () => pr, updateMany: async (query: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    reviewUpdates.push(query);
    if (firstCompletion) {
      const { where, data } = query;
      if ((where.headSha !== undefined && where.headSha !== pr.headSha)
        || (where.reviewRequestVersion !== undefined && where.reviewRequestVersion !== pr.reviewRequestVersion)
        || (where.reviewBody !== undefined && where.reviewBody !== pr.reviewBody)
        || (typeof where.status === "string" && where.status !== pr.status)
        || (where.firstReviewCompletedAt === null && pr.firstReviewCompletedAt !== null)) return { count: 0 };
      Object.assign(pr, data);
    }
    return { count: 1 };
  } },
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
mock.module("@/lib/review-routing", () => ({ resolveReviewModel: async () => adaptiveStage ? "claude-fable-5-1" : "gpt-fixture" }));
mock.module("@/lib/ai-usage", () => ({ logAiUsage: async () => { usageCount++; if (adaptiveStage === "before-validator") adaptiveAbort.abort(); } }));
mock.module("@/lib/ai-router", () => ({ getProviderForModel: async () => {
  assert.ok(adaptiveStage, "Legacy fixture must not resolve adaptive capacity"); return "anthropic";
}, createAiMessage: async (params: AiCreateParams) => {
  if (adaptiveStage) {
    assert.ok(params.completeReviewAdmission, "Oversized complete input must use capacity admission");
    const { observeAiRequest } = await import("@/lib/providers/request-evidence");
    const { capacityReceipt } = await import("@/lib/review-capacity");
    const receipt = capacityReceipt(params.completeReviewAdmission, params.model);
    receipt.state = "admitted"; receipt.primaryDispatch = "started";
    params.completeReviewAdmission.onDecision?.(receipt);
    observeAiRequest(params, "anthropic", { model: params.model, messages: params.messages });
    return { model: params.model, provider: "anthropic", completion: { state: "completed", reason: "end_turn" },
      text: report, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  }
  const { openaiProvider } = await import("@/lib/providers/openai");
  return openaiProvider.create(params, "fixture-key");
} }));
mock.module("@/lib/review-validation", () => ({
  gatherCrossFileContext: async () => "",
  gatherVerificationContext: async () => new Map(),
  validateFindings: async (findings: unknown[]) => {
    validatorCalls++;
    if (adaptiveStage === "during-validator") adaptiveAbort.abort();
    if (adaptiveStage === "expired-validator") adaptiveRemaining = 0;
    return findings;
  },
}));

// Hosted review integration: keep generation, parsing, suppression and finding
// persistence mapping real; replace external services and unrelated prerequisites.
const archived: { id: string; findings: { title: string }[]; coverage: unknown; body: string }[] = [];
const summaries: string[] = [];
const published: { body: string; event: string; comments: unknown[] }[] = [];
const priorReviewComments: { id: number; user: string; path: string; line: number; body: string; inReplyToId: number | null; isOutdated: boolean }[] = [
  { id: 5, user: "fixture[bot]", path: "src/check.ts", line: 1, body: "🟠 Previous unrelated partial-review issue", inReplyToId: null, isOutdated: false },
];
const checkConclusions: string[] = [];
mock.module("@/lib/review-summary-comment", () => ({ publishReviewSummary: async (target: { body: string; headSha: string; reviewRequestVersion: number; expectedReviewBody?: string; executionWindow?: ReviewExecutionWindow }) => {
  if (firstCompletion && pr.status === "completed" && completionFailure === "summary") {
    completionFailure = null;
    assert.equal(pr.firstReviewCompletedAt, null, "Archiving the result must not complete onboarding before publication");
    throw new Error("Fixture final summary publication failed");
  }
  if (target.expectedReviewBody !== undefined) {
    assert.equal(target.expectedReviewBody, archived.at(-1)?.body);
    assert.equal(target.headSha, pr.headSha);
    assert.equal(target.reviewRequestVersion, pr.reviewRequestVersion);
  }
  if (target.executionWindow && ["summary-send", "summary-timeout", "transport-control"].includes(adaptiveStage!)) {
    await fetch("https://synthetic.invalid/summary", { signal: target.executionWindow.signal });
  }
  summaries.push(target.body);
  return 123;
} }));
const realReviewAttempt = await import("@/lib/review-attempt");
mock.module("@/lib/review-attempt", () => ({
  recordFirstReviewCompletion: realReviewAttempt.recordFirstReviewCompletion,
  withForgejoReviewPublication: directCommentFailure ? realReviewAttempt.withForgejoReviewPublication : async (_id: string, _head: string, _version: number, publish: () => Promise<void>) => publish(),
  createReviewAttemptComment: directCommentFailure ? realReviewAttempt.createReviewAttemptComment : async (_id: string, _head: string, _version: number, create: () => Promise<number>) => create(),
  updateCurrentReview: directCommentFailure || firstCompletion ? realReviewAttempt.updateCurrentReview : async () => ({ count: 1 }),
  saveReviewAttempt: async (_id: string, _pr: string, _coverage: unknown, _body: string, findings: { title: string }[]) => {
    archived.push({ id: _id, findings, coverage: structuredClone(_coverage), body: _body });
    if (firstCompletion) Object.assign(pr, { status: "completed", reviewBody: _body });
    if (adaptiveStage === "after-save" && (_coverage as ReviewCoverage).assessment?.state === "completed") adaptiveAbort.abort();
    if ((_coverage as ReviewCoverage).assessment?.state === "completed") completedSnapshot = JSON.stringify(archived.at(-1));
    return firstCompletion || !!adaptiveStage;
  },
}));
mock.module("@/lib/github", () => ({
  LargePrError: class LargePrError extends Error {},
  getPullRequestReviewInput: async () => ({ rawDiff: diff, input: {
    provider: "github", headSha: pr.headSha, baseSha: "b".repeat(40), inventoryComplete: true,
    expectedFiles: 1, limitations: [],
    files: [{ path: "src/check.ts", change: "modified", patch: `@@ -1 +1 @@\n-return value;\n+return value.name;${adaptiveStage ? " ".repeat(400000) : ""}\n`, additions: 1, deletions: 1 }],
  } }),
  getPullRequestDetails: async () => ({ body: "Handle missing values" }),
  createPullRequestComment: async () => { directComments++; return 123; },
  updatePullRequestComment: async (_installation: number, _owner: string, _repo: string, _id: number, body: string) => { summaries.push(body); },
  createPullRequestReview: async (_installation: number, _owner: string, _repo: string, _number: number, body: string, event: string, comments: unknown[]) => {
    if (nativeFailure) throw new Error("fixture native review rejected");
    published.push({ body, event, comments });
    return 456;
  },
  createCheckRun: async () => 789,
  updateCheckRun: async (_installation: number, _owner: string, _repo: string, _id: number, conclusion: string, _output: unknown, window?: ReviewExecutionWindow) => {
    if (firstCompletion && completionFailure === "check") { completionFailure = null; throw new Error("Fixture final check publication failed"); }
    if (window && adaptiveStage === "check-send") await fetch("https://synthetic.invalid/check", { signal: window.signal });
    checkConclusions.push(conclusion);
  },
  getRepositoryTree: async () => ["src/check.ts"],
  getFileContent: async () => "return value.name;",
  listReviewComments: async () => [],
  listPullRequestReviewComments: async () => priorReviewComments,
  listPullRequestIssueComments: async () => [],
  listPullRequestReviews: async () => [],
  getCommentReactions: async () => ({ thumbsUp: 0, thumbsDown: 0 }),
}));
mock.module("@/lib/forgejo", () => ({
  runWithForgejoRepository: async (_repo: string, run: () => Promise<void>) => run(),
  usesForgejoConnector: () => forgejoConnector,
  createPullRequestComment: async (_org: string, _project: string, _number: number, body: string) => {
    forgejoPublications.push(body);
    if (directCommentFailure) throw new Error("Forgejo API returned 403");
    return 123;
  },
  updatePullRequestComment: async (_org: string, _project: string, _number: number, _id: number, body: string) => { forgejoPublications.push(body); },
  getPullRequestReviewInput: async () => { throw new Error("Fixture stops after preparation"); },
  setCommitStatus: async (_org: string, _project: string, _sha: string, state: string) => {
    forgejoPublications.push(state);
    if (state === "running") throw new Error("Forgejo API returned 500");
  },
}));
mock.module("@/lib/bitbucket", () => ({}));
mock.module("@/lib/gitlab", () => ({
  getBranchHead: async () => null,
  getPullRequestReviewInput: async () => ({ rawDiff: diff, input: {
    provider: "gitlab", headSha: pr.headSha, baseSha: "b".repeat(40), inventoryComplete: true,
    expectedFiles: 1, limitations: [],
    files: [{ path: "src/check.ts", change: "modified", patch: `@@ -1 +1 @@\n-return value;\n+return value.name;${" ".repeat(400000)}\n`, additions: 1, deletions: 1 }],
  } }),
  getPullRequestDetails: async () => ({ body: "Handle missing values" }),
  getFileContent: async () => "return value.name;",
  getRepositoryTree: async () => ["src/check.ts"],
  listPullRequestComments: async () => [],
  createPullRequestComment: async (_org: string, _project: string, _number: number, body: string) => { summaries.push(body); return 123; },
  updatePullRequestComment: async (_org: string, _project: string, _number: number, _id: number, body: string) => { summaries.push(body); },
  createInlineComment: async () => 456,
  setCommitStatus: async (_org: string, _project: string, _sha: string, state: string, _name: string, _description: string, _url?: string, window?: ReviewExecutionWindow) => {
    if (window) {
      await Promise.resolve();
      if (adaptiveStage === "gitlab-auth") adaptiveAbort.abort();
      if (adaptiveStage === "gitlab-transport-control") throw new Error("Unrelated status error");
      assertReviewProcessingActive(window);
    }
    checkConclusions.push(state);
  },
}));
mock.module("@/lib/github-app-config", () => ({ getGithubAppConfig: async () => ({ slug: "fixture" }) }));
mock.module("@/lib/queue", () => ({
  loadQueueConfig: async () => ({ reviewTimeoutSeconds: 60, largeReviewTimeoutSeconds: 60 }),
  computeStaleReclaimMs: () => 120000,
  enqueue: async () => {}, enqueueAfter: async () => {},
}));
mock.module("@/lib/cost", () => ({ getOrgSpendLimitStatus: async () => ({ blocked: false }), shouldGuardConcurrency: async () => false }));
mock.module("@/lib/pubby", () => ({ pubby: { trigger: async (_channel: string, _name: string, data: { status?: string }) => { events.push(data); } } }));
mock.module("@/lib/events", () => ({ eventBus: { emit: (event: { type: string }) => { events.push(event); } } }));
mock.module("@/lib/indexer", () => ({ indexRepository: async () => {
  if (!preserveAutoReview) throw new Error("unexpected indexing");
  return { indexedFiles: 1, totalFiles: 1, totalChunks: 1, totalVectors: 1, durationMs: 1, contributorCount: 0, contributors: [] };
} }));
mock.module("@/lib/review-repository-preparation", () => ({
  ensureRepositoryAnalysis: async (_repo: string, _org: string, onStart: () => Promise<void>) => {
    if (repo.provider === "forgejo") {
      await onStart();
      if (preparationState === "failure") throw new Error("Repository analysis failed");
    }
    return preparationState;
  },
  deferReviewForRepository: async () => {},
}));
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
if (firstCompletion) {
  const errors = console.error;
  console.error = () => {};
  try {
    completionFailure = "summary";
    await processReview("pr");
    assert.equal(archived.length, 1, "The failure happens after the actual reviewer archives its result");
    assert.equal(pr.firstReviewCompletedAt, null, "Failed final publication cannot complete onboarding");
    pr.status = "pending";
    completionFailure = "check";
    await processReview("pr");
    assert.equal(pr.firstReviewCompletedAt, null, "A failed required native check cannot complete onboarding");
    pr.status = "pending";
    await processReview("pr");
    assert.ok(pr.firstReviewCompletedAt instanceof Date, "The actual reviewer records successful publication");
    const first = pr.firstReviewCompletedAt.getTime();
    pr.status = "pending";
    completionFailure = "check";
    await processReview("pr");
    assert.equal(pr.firstReviewCompletedAt.getTime(), first, "A later failed request preserves the achievement");
    pr.status = "pending";
    await processReview("pr");
    assert.equal(pr.firstReviewCompletedAt.getTime(), first, "Later successful requests preserve the first timestamp");
  } finally { console.error = errors; }
  console.log("PASS first review completion follows final publication and survives reruns");
  process.exit(0);
}
if (preserveAutoReview) {
  repo.indexStatus = "pending";
  await processReview("pr");
  assert.equal(repo.indexStatus, "indexed", "the real reviewer must exercise automatic preparation");
  assert.equal(repo.autoReview, false, "a one-off review must not enable automatic reviews");
  assert.equal(archived.at(-1)?.coverage.assessment?.state, "completed");
  console.log("PASS one-off review preparation preserves disabled automatic reviews");
  process.exit(0);
}
if (directCommentFailure) {
  repo.provider = "forgejo";
  const errors = console.error;
  console.error = () => {};
  try { await processReview("pr"); } finally { console.error = errors; }
  assert.ok(forgejoPublications.some(body => body.includes("Preparing review")));
  assert.ok(reviewUpdates.some(query => {
    const { where, data } = query as { where: unknown; data: { status?: string; errorMessage?: string } };
    if (data.status !== "failed") return false;
    assert.deepEqual(where, { id: pr.id, headSha: pr.headSha, reviewRequestVersion: pr.reviewRequestVersion });
    assert.equal(data.errorMessage, "Forgejo API returned 403");
    return true;
  }), "Direct comment failure is persisted for the same review attempt");
  assert.ok(events.some(event => event.type === "review-failed"));
  console.log("PASS handled direct Forgejo comment failure without connector uncertainty");
  process.exit(0);
}
if (approveCleanReviews) {
  const cleanReport = report.replace(JSON.stringify([finding]), "[]").replace("| 🟠 High | 1 |", "| 🟠 High | 0 |");
  responseOverride = cleanReport;
  await processReview("pr");
  assert.equal((archived.at(-1)!.coverage as ReviewCoverage).assessment?.state, "completed");
  assert.deepEqual(archived.at(-1)!.findings, []);
  assert.equal(published.at(-1)!.event, "COMMENT", "a clean review stays a COMMENT while the setting is off");
  org.approveCleanReviews = true;
  await processReview("pr");
  assert.equal(published.at(-1)!.event, "APPROVE", "a clean first review approves with the setting on");
  responseOverride = null;
  await processReview("pr");
  assert.equal(published.at(-1)!.comments.length, 1);
  assert.equal(published.at(-1)!.event, "COMMENT", "one finding blocks the approval");
  prior = { ...structuredClone(archived.at(-1)!.coverage as ReviewCoverage), reviewRequestVersion: 1 };
  responseOverride = cleanReport;
  await processReview("pr");
  assert.ok(received.messages[0].content.includes("RE-REVIEW MODE"));
  assert.equal(published.at(-1)!.event, "COMMENT", "an earlier inline comment that is open blocks the approval on a re-review");
  priorReviewComments[0].isOutdated = true;
  await processReview("pr");
  assert.equal(published.at(-1)!.event, "APPROVE", "a re-review approves once every earlier inline comment is outdated");
  priorReviewComments[0].isOutdated = false;
  priorReviewComments.push({ id: 6, user: "fixture", path: "src/check.ts", line: 1, body: "Fixed in the last commit.", inReplyToId: 5, isOutdated: false });
  await processReview("pr");
  assert.equal(published.at(-1)!.event, "APPROVE", "a re-review approves once every earlier inline comment has a reply");
  console.log("PASS clean reviews approve only with the setting on and settled earlier comments");
  process.exit(0);
}
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
// Complete prior input must not turn invalid zero-finding follow-ups positive.
responseOverride = report.replace(JSON.stringify([finding]), "[]").replace("| 🟠 High | 1 |", "| 🟠 High | 0 |").replace("### Score", "### Score\n### Score");
await processReview("pr");
assert.equal((archived.at(-1)!.coverage as ReviewCoverage).complete, true);
assert.equal((archived.at(-1)!.coverage as ReviewCoverage).assessment?.state, "incomplete");
assert.ok(!summaries.at(-1)!.includes("No new issues detected"));
assert.ok(!/\|[^\n]*[1-5]\/5/.test(summaries.at(-1)!));
assert.ok(summaries.at(-1)!.includes("Input complete; assessment invalid or unavailable"));
if (process.env.REVIEW_TEST_EVIDENCE_DIR) {
  await Bun.write(`${process.env.REVIEW_TEST_EVIDENCE_DIR}/invalid-zero-follow-up.json`, JSON.stringify({ archived: archived.at(-1), publishedComment: summaries.at(-1) }, null, 2));
  await Bun.write(`${process.env.REVIEW_TEST_EVIDENCE_DIR}/invalid-zero-follow-up.html`, '<!doctype html><meta charset="utf-8"><title>Invalid zero-findings follow-up</title>' + Bun.markdown.html(summaries.at(-1)!));
}
responseOverride = report.replace("### Findings\n", "> ⚠️ **Conflict Risk**: Shared files changed; coordinate with related work.\n\n### Findings\n");
await processReview("pr");
assert.equal((archived.at(-1)!.coverage as ReviewCoverage).assessment?.state, "completed");
responseOverride = null;
providerInterrupted = true;
const errorLog = console.error;
console.error = () => {};
try {
  await processReview("pr");
  assert.equal((archived.at(-1)!.coverage as ReviewCoverage).complete, true);
  assert.equal((archived.at(-1)!.coverage as ReviewCoverage).assessment?.state, "incomplete");
  assert.equal((archived.at(-1)!.coverage as ReviewCoverage).assessment?.reason, "Provider request failed or was interrupted");
} finally { providerInterrupted = false; console.error = errorLog; }
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
  assert.equal((archived.at(-1)!.coverage as ReviewCoverage).complete, true);
  assert.equal((archived.at(-1)!.coverage as ReviewCoverage).assessment?.state, "incomplete");
  if (process.env.REVIEW_TEST_EVIDENCE_DIR) {
    await Bun.write(`${process.env.REVIEW_TEST_EVIDENCE_DIR}/malformed-assessment.json`, JSON.stringify(archived.at(-1), null, 2));
  }
} finally { console.warn = warn; }
console.log("PASS incomplete retry findings, inline publication and assessment gates");

prior = null;
malformed = false;
responseOverride = null;
providerInterrupted = false;
nativeFailure = true;
lookupFailure = false;
const beforeFallback = archived.length;
const originalError = console.error;
console.error = () => {};
try { await processReview("pr"); } finally { console.error = originalError; }
assert.equal(archived.length, beforeFallback + 1);
assert.equal(directComments, 0, "Native failures must not create untracked comments");
assert.ok(summaries.at(-1)?.includes("Missing null check"));
assert.ok(summaries.at(-1)?.includes("### Score"));
assert.ok(summaries.at(-1)?.includes("Review coverage"));

// The real hosted post-primary pipeline must not publish a scored completion after cancellation.
nativeFailure = false;
for (const stage of ["before-validator", "during-validator", "expired-validator", "after-save"] as const) {
  adaptiveStage = stage; adaptiveAbort = new AbortController(); adaptiveRemaining = 900000;
  const before = archived.length, validations = validatorCalls, checks = checkConclusions.length;
  const errors = console.error; console.error = () => {};
  try {
    await processReview("pr", { jobId: "synthetic-adaptive", deadlineEpochMs: Date.now() + 900000,
      signal: adaptiveAbort.signal, remainingMs: () => adaptiveRemaining });
  } finally { console.error = errors; }
  const failed = archived.at(-1)!;
  const coverage = failed.coverage as ReviewCoverage;
  assert.equal(coverage.assessment?.state, "incomplete", stage);
  assert.equal(coverage.assessment?.requests.length, 1, stage);
  assert.equal(coverage.assessment?.capacityAdmission?.primaryDispatch, "started", stage);
  assert.equal(coverage.files[0].state, "supplied", stage);
  assert.ok(coverage.assessment?.reason.includes("cancelled or expired"), stage);
  assert.ok(!/\|[^\n]*[1-5]\/5/.test(summaries.at(-1)!), stage);
  assert.ok(summaries.at(-1)!.startsWith(`Review attempt: ${failed.id}. Head:`), stage);
  assert.ok(summaries.at(-1)!.includes(`/api/review-attempts/${failed.id}`), stage);
  assert.ok(!checkConclusions.slice(checks).includes("success"), stage);
  if (stage === "before-validator") assert.equal(validatorCalls, validations);
  else assert.equal(validatorCalls, validations + 1);
  if (stage === "after-save") {
    assert.equal(archived.length, before + 2);
    assert.notEqual(archived.at(-2)!.id, failed.id);
    assert.equal((archived.at(-2)!.coverage as ReviewCoverage).assessment?.state, "completed");
    assert.ok(coverage.limitations.some(reason => reason.includes(archived.at(-2)!.id)));
  } else assert.equal(archived.length, before + 1);
}
console.log("PASS adaptive post-primary expiry preserves evidence and suppresses scored publication");

for (const stage of ["summary-send", "summary-timeout", "check-send", "gitlab-auth", "transport-control", "gitlab-transport-control"] as const) {
  adaptiveStage = stage; adaptiveAbort = new AbortController(); adaptiveRemaining = 900000;
  repo.provider = stage.startsWith("gitlab") ? "gitlab" : "github";
  const before = archived.length, priorUsage = usageCount, beforeEvents = events.length;
  const errors = console.error; console.error = () => {};
  try {
    await processReview("pr", { jobId: "synthetic-adaptive", deadlineEpochMs: Date.now() + 900000,
      signal: adaptiveAbort.signal, remainingMs: () => adaptiveRemaining });
  } finally { console.error = errors; }
  assert.equal(usageCount, priorUsage + 1, stage);
  assert.equal(JSON.stringify(archived[before]), completedSnapshot, stage);
  assert.equal((archived[before].coverage as ReviewCoverage).assessment?.state, "completed", stage);
  const outcomeEvents = events.slice(beforeEvents);
  if (stage.endsWith("control")) {
    assert.equal(archived.length, before + 1, stage);
    assert.equal(outcomeEvents.some(event => event.type === "review-completed"), stage === "gitlab-transport-control", stage);
    continue;
  }
  assert.equal(archived.length, before + 2, stage);
  const failed = archived.at(-1)!;
  const coverage = failed.coverage as ReviewCoverage;
  assert.notEqual(failed.id, archived[before].id, stage);
  assert.equal(coverage.assessment?.state, "incomplete", stage);
  assert.equal(coverage.assessment?.requests.length, 1, stage);
  assert.equal(coverage.assessment?.capacityAdmission?.primaryDispatch, "started", stage);
  assert.equal(coverage.files[0].state, "supplied", stage);
  assert.ok(coverage.limitations.some(reason => reason.includes(archived[before].id)), stage);
  assert.ok(summaries.at(-1)!.startsWith(`Review attempt: ${failed.id}. Head:`), stage);
  assert.ok(summaries.at(-1)!.includes(`/api/review-attempts/${failed.id}`), stage);
  assert.ok(!/\|[^\n]*[1-5]\/5/.test(summaries.at(-1)!), stage);
  assert.ok(["failure", "failed"].includes(checkConclusions.at(-1)!), stage);
  assert.ok(!outcomeEvents.some(event => event.type === "review-completed" || event.status === "completed"), stage);
  assert.ok(outcomeEvents.some(event => event.type === "review-failed"), stage);
  if (process.env.REVIEW_TEST_EVIDENCE_DIR) {
    await Bun.write(`${process.env.REVIEW_TEST_EVIDENCE_DIR}/publication-${stage}.json`, JSON.stringify({ archived: archived.slice(before), publishedComment: summaries.at(-1), finalCheck: checkConclusions.at(-1), usageRecorded: usageCount - priorUsage, events: outcomeEvents }, null, 2));
    await Bun.write(`${process.env.REVIEW_TEST_EVIDENCE_DIR}/publication-${stage}.html`, '<!doctype html><meta charset="utf-8"><title>Synthetic publication expiry</title>' + Bun.markdown.html(summaries.at(-1)!));
  }

}
console.log("PASS after-save publication expiry and unrelated transport controls");

adaptiveStage = null;
repo.provider = "forgejo";
for (const connector of [false, true]) {
  forgejoConnector = connector;
  for (const preparation of ["waiting", "failure", "ready"] as const) {
    preparationState = preparation;
    forgejoPublications.length = 0;
    const beforeEvents = events.length;
    const errors = console.error;
    console.error = () => {};
    try { await processReview("pr"); } finally { console.error = errors; }
    if (connector) {
      assert.deepEqual(forgejoPublications, preparation === "waiting" ? [] : preparation === "failure" ? ["failed"] : ["running", "failed"]);
    } else {
      assert.equal(forgejoPublications[0], "running");
      assert.ok(forgejoPublications[1].includes("Preparing review"));
      assert.ok(forgejoPublications[2].includes("Analyzing repository"));
      if (preparation === "waiting") {
        assert.ok(forgejoPublications.at(-1)!.includes("retry automatically"));
        assert.ok(!events.slice(beforeEvents).some(event => event.type === "review-failed"));
      } else if (preparation === "failure") {
        assert.ok(forgejoPublications.some(body => body.includes("Repository analysis failed")));
        assert.equal(forgejoPublications.at(-1), "failed");
      } else {
        assert.ok(forgejoPublications.some(body => body.includes("Starting PR review")));
      }
    }
  }
}
console.log("PASS direct Forgejo progress and best-effort status, connector publication deferral");
