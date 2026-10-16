import { mock } from "bun:test";
import assert from "node:assert/strict";

// A process-local HTTP service exercises the production Qdrant client/adapter.
// No Qdrant, model, provider or database service is contacted by this fixture.
const requests: { path: string; body: Record<string, unknown> }[] = [];
let denseScore: unknown = 0.1;
let feedback: unknown = "down";
let searchFailure = false;
let emptyResults = false;
let collectionFailure = false;
let resultOverride: unknown;
let splitScores = false;
const service = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const body = request.method === "GET" ? {} : await request.json();
    requests.push({ path, body });
    if (path === "/") return Response.json({ version: "1.18.0" });
    if (path === "/collections") {
      if (collectionFailure) return Response.json({}, { status: 503 });
      return Response.json({ result: { collections: [{ name: "feedback_patterns" }] }, status: "ok" });
    }
    if (path === "/collections/feedback_patterns") return Response.json({ result: true, status: "ok" });
    const isFeedback = path.includes("/feedback_patterns/");
    if (isFeedback && searchFailure) return Response.json({ status: { error: "fixture service failure" } }, { status: 503 });
    const points = isFeedback && resultOverride !== undefined ? resultOverride : !isFeedback || emptyResults ? [] : [{
      id: 1,
      // Rank 1 in both RRF lists can score 1 even with weak dense similarity.
      score: path.endsWith("/query") ? 1 : splitScores && body.vector?.[1] === 1 ? 0.1 : denseScore,
      payload: { title: "Previously dismissed", description: "A different issue", feedback, repoId: "repo", orgId: "org" },
    }];
    // JSON exponent overflow exercises a non-finite numeric transport result.
    const json = JSON.stringify({ result: path.endsWith("/query") ? { points } : points, status: "ok" });
    return new Response(denseScore === Infinity ? json.replace('"score":null', '"score":1e999') : json, {
      headers: { "content-type": "application/json" },
    });
  },
});
process.env.QDRANT_URL = service.url.toString();
mock.module("server-only", () => ({}));
mock.module("@/lib/embed-config", () => ({ getEmbedConfig: () => ({ dim: 3 }) }));

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
  headSha: "a".repeat(40), reviewRequestVersion: 1, status: "pending",
};
const outcomeTransaction = {
  pullRequest: { updateMany: async () => ({ count: 1 }) },
  $executeRawUnsafe: async () => 0,
  $executeRaw: async () => 0,
  $queryRaw: async () => [{ lock: "0", statement: "0" }],
};
mock.module("@octopus/db", () => ({ prisma: {
  $transaction: async (run: (tx: typeof outcomeTransaction) => Promise<unknown>) => run(outcomeTransaction),
  repository: { findUnique: async () => repo, findMany: async () => [{ id: repo.id, activeIndexGeneration: null }] },
  systemConfig: { findUnique: async () => null },
  reviewIssue: { findMany: async () => [] },
  reviewAttempt: { findFirst: async () => null },
  pullRequest: { findUnique: async () => pr, updateMany: async () => ({ count: 1 }) },
} }));
let embeddingFailure = false;
let embeddingVectors: number[][] | undefined;
const embeddingCalls: { texts: string[]; tracking: unknown }[] = [];
mock.module("@/lib/embeddings", () => ({ createEmbeddings: async (texts: string[], tracking: unknown) => {
  embeddingCalls.push({ texts, tracking });
  if (embeddingFailure) throw new Error("fixture embedding failure");
  return embeddingVectors ?? texts.map(() => [1, 0, 0]);
} }));
mock.module("@/lib/reranker", () => ({ rerankDocuments: async () => [] }));
mock.module("@/lib/knowledge-context", () => ({ getAlwaysIncludeKnowledge: async () => [], mergeKnowledgeChunks: () => [] }));
mock.module("@/lib/review-routing", () => ({ resolveReviewModel: async () => "fixture-model" }));
mock.module("@/lib/ai-usage", () => ({ logAiUsage: async () => {} }));
mock.module("@/lib/ai-router", () => ({ getProviderForModel: async () => { throw new Error("Legacy fixture must not resolve adaptive capacity"); }, createAiMessage: async () => ({
  provider: "fixture", text: `Summary\n<!-- OCTOPUS_FINDINGS_START -->\n${JSON.stringify([finding])}\n<!-- OCTOPUS_FINDINGS_END -->`,
  usage: { inputTokens: 1, outputTokens: 1 },
}) }));
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
mock.module("@/lib/review-summary-comment", () => ({ publishReviewSummary: async (target: { body: string }) => {
  summaries.push(target.body);
  return 123;
} }));
mock.module("@/lib/review-attempt", () => ({
  recordFirstReviewCompletion: async () => { throw new Error("Fixture must stop before completion"); },
  withForgejoReviewPublication: async () => { throw new Error("Unexpected Forgejo publication"); },
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
  listPullRequestReviewComments: async () => [],
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

try {
  const { generateLocalReview } = await import("@/lib/review-core");
  const { suppressFindingsFromFeedback } = await import("@/lib/feedback-suppression");
  const { searchFeedbackPatterns } = await import("@/lib/qdrant");
  const weak = await generateLocalReview({ diff, repoId: "repo", orgId: "org" });
  assert.equal(weak.findings.length, 1, "a first-ranked RRF hit with cosine 0.1 must retain the finding");
  denseScore = 0.95;
  const strong = await generateLocalReview({ diff, repoId: "repo", orgId: "org" });
  assert.equal(strong.findings.length, 0, "a strong negative cosine match suppresses the finding");

  const originals = [finding];
  const runStage = () => suppressFindingsFromFeedback(originals, { repoId: "repo", orgId: "org" });
  for (const [score, vote, retained] of [
    [0.95, "down", 0], [1, "down", 0], [0.800001, "down", 0],
    [0.8, "down", 1], [0.79, "down", 1], [-1, "down", 1],
    [0.99, "up", 1], [0.99, "unknown", 1], [0.99, null, 1],
    [NaN, "down", 1], [Infinity, "down", 1], [1.01, "down", 1],
    [-1.01, "down", 1], ["0.99", "down", 1], [null, "down", 1],
  ] as const) {
    denseScore = score;
    feedback = vote;
    const result = await runStage();
    assert.equal(result.length, retained, `score=${String(score)} feedback=${String(vote)}`);
    if (retained) assert.equal(result[0], finding, "retained findings preserve their identity and fields");
  }
  denseScore = 0.95;
  feedback = "down";
  assert.deepEqual(await searchFeedbackPatterns("repo", [1, 0, 0], "org"), [{ feedback: "down", cosineSimilarity: 0.95 }]);
  const feedbackRequests = () => requests.filter(({ path }) => path.includes("/feedback_patterns/points/"));
  for (const request of feedbackRequests()) {
    assert.equal(request.path, "/collections/feedback_patterns/points/search", "suppression never consumes an RRF result");
    assert.deepEqual(request.body, {
      vector: [1, 0, 0], limit: 3, offset: 0, with_payload: true, with_vector: false,
      filter: { should: [{ key: "repoId", match: { value: "repo" } }, { key: "orgId", match: { value: "org" } }] },
    }, "the bounded request preserves the existing repo-or-org policy");
  }
  await searchFeedbackPatterns("repo", [1, 0, 0]);
  assert.deepEqual(feedbackRequests().at(-1)?.body.filter, { must: [{ key: "repoId", match: { value: "repo" } }] });

  for (const malformed of [null, {}, [null], [{ score: 0.99 }], [{ score: 0.99, payload: "down" }],
    [{ score: 0.99, payload: { feedback: "down", repoId: "other", orgId: "other" } }]]) {
    resultOverride = malformed;
    assert.deepEqual(await runStage(), originals, "malformed or out-of-scope results retain findings");
  }
  resultOverride = [{ score: 0.95, payload: { feedback: "down", repoId: "another-repo", orgId: "org" } }];
  assert.deepEqual(await runStage(), [], "same-org cross-repo feedback remains eligible under the existing policy");
  assert.deepEqual(await searchFeedbackPatterns("repo", [1, 0, 0]), [], "repo-only callers do not accept another repository");
  resultOverride = [0.1, 0.2, 0.3, 0.99].map((score) => ({ score, payload: { feedback: "down", repoId: "repo" } }));
  assert.deepEqual(await runStage(), originals, "even an oversized service response cannot exceed three candidates");
  resultOverride = undefined;
  emptyResults = true;
  assert.deepEqual(await runStage(), originals, "empty results retain findings");
  emptyResults = false;
  searchFailure = true;
  assert.deepEqual(await runStage(), originals, "Qdrant failure retains findings");
  searchFailure = false;

  const searchCount = feedbackRequests().length;
  for (const vectors of [[[]], [[0, 0, 0]], [[NaN, 0, 0]], [[Infinity, 0, 0]], [], [[1, 0, 0], [1, 0, 0]]]) {
    embeddingVectors = vectors;
    assert.deepEqual(await runStage(), originals, "invalid or unaligned embeddings retain findings");
  }
  assert.equal(feedbackRequests().length, searchCount, "invalid vectors never reach Qdrant");
  embeddingVectors = undefined;
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args); };
  try {
    embeddingFailure = true;
    assert.equal(await runStage(), originals, "embedding failure returns the original findings");
    embeddingFailure = false;
    collectionFailure = true;
    assert.equal(await runStage(), originals, "collection failure returns the original findings");
    collectionFailure = false;
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 2, "failures are reported without failing the review");
  const beforeEmpty = { requests: requests.length, embeddings: embeddingCalls.length };
  assert.deepEqual(await suppressFindingsFromFeedback([], { repoId: "repo", orgId: "org" }), []);
  assert.deepEqual({ requests: requests.length, embeddings: embeddingCalls.length }, beforeEmpty, "empty findings skip remote work");
  embeddingVectors = [[1, 0, 0], [0, 1, 0]];
  splitScores = true;
  const other = { ...finding, title: "Second finding", confidence: 91 };
  assert.deepEqual(await suppressFindingsFromFeedback([finding, other], { repoId: "repo", orgId: "org" }), [other]);
  assert.deepEqual(embeddingCalls.at(-1), {
    texts: [`${finding.title} ${finding.description}`, `${other.title} ${other.description}`],
    tracking: { organizationId: "org", operation: "embedding", repositoryId: "repo" },
  }, "finding/vector alignment and embedding cost attribution are preserved");
  embeddingVectors = undefined;
  splitScores = false;
  const { parseFindingsFromJson } = await import("@/lib/review-dedup");
  const evidence: unknown[] = [];
  const { processReview } = await import("@/lib/reviewer");
  for (const [score, vote, fails, retained] of [
    [0.1, "down", false, 1], [0.8, "down", false, 1],
    [0.95, "down", false, 0], [0.99, "up", false, 1], [0.95, "down", true, 1],
  ] as const) {
    denseScore = score;
    feedback = vote;
    searchFailure = fails;
    const local = await generateLocalReview({ diff, repoId: "repo", orgId: "org" });
    const before = archived.length;
    await processReview("pr");
    assert.equal(archived.length, before + 1, "hosted review reaches finding persistence");
    assert.equal(local.findings.length, retained);
    assert.deepEqual(archived.at(-1)?.findings.map((value) => value.title), local.findings.map((value) => value.title),
      "hosted persistence and local output apply the same semantic suppression decision");
    assert.equal(published.at(-1)?.comments.length, retained, "hosted inline publication uses the suppressed union");
    assert.equal(parseFindingsFromJson(archived.at(-1)!.body)?.length, 1, "the archived raw model response preserves its findings markers");
    assert.deepEqual(archived.at(-1)!.coverage, archived[0].coverage, "suppression does not change review coverage");
    assert.equal(local.model, "fixture-model", "model routing is preserved");
    assert.equal(local.summary, "Summary", "local summary excludes the findings protocol block");
    assert.match(published.at(-1)!.body, new RegExp(`${retained} finding`), "summary count agrees with inline findings");
    evidence.push({ cosineSimilarity: score, feedback: vote, searchFailure: fails, local, hosted: published.at(-1), summaryComment: summaries.at(-1), persistence: archived.at(-1) });
  }
  if (process.env.FEEDBACK_EVIDENCE_PATH) {
    await Bun.write(process.env.FEEDBACK_EVIDENCE_PATH, JSON.stringify(evidence, null, 2));
  }
  console.log("PASS semantic feedback similarity and review consumers");
} finally {
  service.stop(true);
}
