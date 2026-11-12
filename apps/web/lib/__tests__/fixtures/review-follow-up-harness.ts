import { generationBudget } from "./review-outcome-stub";
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import type { AiCreateParams } from "@/lib/providers";
import { assertReviewProcessingActive, type ReviewExecutionWindow, type CapacityRefusalReason } from "@/lib/review-capacity";
import type { ReviewCoverage } from "@/lib/review-coverage";
mock.module("server-only", () => ({}));
const sentryEvents: Array<{ tags?: Record<string, unknown>; contexts?: Record<string, Record<string, unknown>> }> = [];
mock.module("@sentry/nextjs", () => ({ captureEvent: (event: typeof sentryEvents[number]) => { sentryEvents.push(event); return "e".repeat(32); } }));
const indexingPrivacy = process.argv.includes("--indexing-review-privacy");
const preparationDiagnostic = process.argv.includes("--preparation-diagnostic");
const directCommentFailure = process.argv.includes("--direct-forgejo-comment-failure");
const preserveAutoReview = process.argv.includes("--preserve-auto-review");
const crashRecovery = process.argv.includes("--crash-recovery");
const firstCompletion = process.argv.includes("--first-review-completion") || crashRecovery;
type Delivery = { attemptId: string; mainCommentId: unknown; completedAt: Date | null; leaseToken: string | null; leaseUntil: Date | null };
const deliveries = new Map<string, Delivery>();
let leaseHeldWhilePublishing = false;
let priorBotReviews: { id: number; user: string; body: string }[] = [];
const delayedJobs: unknown[][] = [];
const interruptedAttempts: unknown[] = [];
const refusalFlow = process.argv.includes("--provider-refusal");
const providerErrorPrivacy = process.argv.includes("--provider-error-privacy");
const generationRetry = process.argv.includes("--generation-retry");
const generationDiagnostic = process.argv.includes("--generation-failure-diagnostic") || generationRetry;
type GenerationOutcome = "terminated" | "unavailable" | "organization-auth" | "rate-limit" | "unknown" | "deadline" | "setup" | "success";
let generationFailure: GenerationOutcome = "terminated";
// Scripted primary-generation outcomes; when empty every dispatch fails with `generationFailure`.
const generationScript: GenerationOutcome[] = [];
let retryAfterHeader = "1";
// Adapters such as a CLI send no request receipt.
let recordRequests = true;
// A change that takes effect after the first failed dispatch, i.e. between the two attempts.
type RetryBlock = "" | "head" | "superseded" | "cancelled" | "key" | "key-cancelled" | "access" | "spend" | "guard";
let pendingRetryBlock: RetryBlock = "";
let retryBlock: RetryBlock = "";
let retryAbort = new AbortController();
const unknownUsage: string[] = [];
const chargeKeys: string[] = [];
let generationDispatches = 0;
const embeddingCancelPrivacy = process.argv.includes("--embedding-cancel-privacy");
const embeddingErrorPrivacy = process.argv.includes("--embedding-error-privacy") || embeddingCancelPrivacy;
let embeddingCalls = 0;
const bestEffortPrivacy = process.argv.includes("--best-effort-privacy");
const publicationErrorPrivacy = process.argv.includes("--publication-error-privacy");
const generationSetupErrorPrivacy = process.argv.includes("--generation-setup-error-privacy");
let failureSite = "";
const reviewAttempts: number[] = [];
let privacyGenerationCalls = 0;
let feedbackMode = "";
const feedbackUpdates: unknown[] = [];
const feedbackIssue = { id: "issue", title: "Missing null check", description: "A missing value causes this access to throw.", severity: "high", githubCommentId: 5, createdAt: new Date(0), pullRequest: { repositoryId: "repo", repository: { organizationId: "org" } } };
const privateFailure = () => Object.assign(new Error("synthetic-best-effort-private"), { status: 503, request_id: "req_syntheticprivate123" });
const localClassification = process.argv.includes("--local-classification");
let localFailure: { message: string; provider: "local" | "ollama" | "openai"; status?: number; code?: string; name?: string; keyOwner?: "platform" | "organization" | "unknown"; unwrapped?: boolean; throwValue?: boolean } | null = null;
if (refusalFlow) process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com";
let refusalCalls = 0;
let preparationFetchFailure: "review_input" | "repository_tree" | "large_pr" | null = null;
const queuedJobs: string[] = [];
class FixtureLargePrError extends Error { meta = { reason: "diff_too_large" }; }
let indexPreparation: "normal" | "fail" | "replace" | "replace-success" = "normal";
let indexingCalls = 0;
let peerAlreadyIndexed = false;
let indexTransactions = 0;
let inIndexTransaction = false;
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
let capacityReason: CapacityRefusalReason = "metadata-unavailable";
let capacityAbort: "cancel" | "timeout" | "expired" | null = null;
let adaptiveStage: "admission" | "generation-cancel" | "generation-timeout" | "generation-expired" | "before-validator" | "during-validator" | "expired-validator" | "after-save" | "summary-send" | "check-send" | "summary-timeout" | "gitlab-auth" | "transport-control" | "gitlab-transport-control" | null = null;
let adaptiveAbort = new AbortController();
let adaptiveRemaining = 900000;
let validatorCalls = 0;
let usageCount = 0;
const usageOperations: string[] = [];
const events: { type?: string; status?: string; eventName?: string; message?: string; error?: string }[] = [];
let completedSnapshot: string | undefined;
globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
  if (refusalFlow && String(_url) === "https://api.anthropic.com/v1/messages") {
    refusalCalls++;
    const messages = [
      { type: "message_start", message: { id: "fixture", type: "message", role: "assistant", model: "claude-fable-5-1", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: "message_delta", delta: { stop_reason: "refusal", stop_sequence: null }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ];
    return new Response(messages.map(message => `event: ${message.type}\ndata: ${JSON.stringify(message)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  }
  assert.ok(init?.signal);
  await Promise.resolve();
  if (adaptiveStage === "transport-control") throw new Error("Unrelated transport error");
  if (adaptiveStage === "summary-timeout") {
    adaptiveRemaining = 0;
    adaptiveAbort.abort();
    throw adaptiveAbort.signal.reason;
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
const org = { id: "org", defaultReviewConfig: {}, reviewLanguage: "en" };
const repo = {
  id: "repo", fullName: "fixture/repo", organization: org, reviewConfig: {},
  provider: "github", installationId: 1, indexStatus: "indexed", defaultBranch: "main",
  organizationId: "org", autoReview: false, indexAttemptId: null as string | null,
  indexedAt: null as Date | null, firstIndexedAt: null as Date | null,
};
const pr = {
  id: "pr", repository: repo, number: 1, title: "Handle missing values", author: "fixture",
  headSha: "a".repeat(40), reviewRequestVersion: 2, status: "pending", reviewBody: null as string | null, reviewCoverage: null,
  firstReviewCompletedAt: null as Date | null,
};
const db = {
  $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
    const before = structuredClone(repo);
    inIndexTransaction = true;
    try { return await run(db); }
    catch (error) { Object.assign(repo, before); throw error; }
    finally { inIndexTransaction = false; }
  },
  $executeRaw: async (_strings: TemplateStringsArray, completedAt: Date) => {
    assert.ok(inIndexTransaction);
    indexTransactions++;
    if (!repo.indexedAt) repo.firstIndexedAt = completedAt;
    repo.indexedAt = completedAt;
    return 1;
  },
  reviewAttempt: { findFirst: async (query: unknown) => {
    assert.deepEqual(query, { where: { pullRequestId: "pr" }, orderBy: { createdAt: "desc" }, select: { coverage: true } });
    if (lookupFailure) throw new Error("fixture lookup failure");
    return prior ? { coverage: prior } : null;
  }, findUnique: async ({ where }: { where: { id: string } }) => {
    const row = archived.find(attempt => attempt.id === where.id);
    return row ? { id: row.id, reviewBody: row.body, coverage: row.coverage, delivery: deliveries.get(row.id) ?? null } : null;
  } },
  // Delivery checkpoints as the real table keeps them: one row per attempt, claimed by an unexpired lease.
  reviewAttemptDelivery: {
    createMany: async ({ data }: { data: { attemptId: string }[] }) => {
      for (const row of data) if (!deliveries.has(row.attemptId)) deliveries.set(row.attemptId, { ...row, mainCommentId: null, completedAt: null, leaseToken: null, leaseUntil: null });
    },
    findUniqueOrThrow: async ({ where }: { where: { attemptId: string } }) => ({ ...deliveries.get(where.attemptId)! }),
    updateMany: async ({ where, data }: { where: { attemptId: string; completedAt?: null; leaseToken?: string; leaseUntil?: { gt: Date }; OR?: unknown[] }; data: Partial<Delivery> }) => {
      const row = deliveries.get(where.attemptId);
      if (!row || (where.completedAt === null && row.completedAt) || (where.leaseToken !== undefined && where.leaseToken !== row.leaseToken)
        || (where.leaseUntil && (!row.leaseUntil || row.leaseUntil <= where.leaseUntil.gt)) || (where.OR && row.leaseUntil && row.leaseUntil > new Date())) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  },
  repository: {
    findFirst: async () => retryBlock === "access" ? null : { ...repo },
    findUnique: async () => ({ ...repo }),
    findUniqueOrThrow: async () => ({ ...repo }),
    updateMany: async ({ where, data }: { where: { id: string; indexStatus?: string | { notIn: string[] }; indexAttemptId?: string }; data: Record<string, unknown> }) => {
      if (peerAlreadyIndexed && typeof where.indexStatus === "object") { repo.indexStatus = "indexed"; return { count: 0 }; }
      if (where.id !== repo.id || (where.indexAttemptId !== undefined && where.indexAttemptId !== repo.indexAttemptId)
        || (typeof where.indexStatus === "string" && where.indexStatus !== repo.indexStatus)
        || (typeof where.indexStatus === "object" && where.indexStatus.notIn.includes(repo.indexStatus))) return { count: 0 };
      Object.assign(repo, data); return { count: 1 };
    },
    update: async ({ data }: { data: Record<string, unknown> }) => { if (bestEffortPrivacy && failureSite === "tree-cache") throw privateFailure(); Object.assign(repo, data); return repo; },
  },
  systemConfig: { findUnique: async () => null },
  organization: { findUnique: async () => org },
  localAgent: { count: async () => 0 },
  reviewIssue: { findMany: async () => bestEffortPrivacy && feedbackMode ? [feedbackIssue] : [], updateMany: async (query: unknown) => { feedbackUpdates.push(query); return { count: 1 }; } },
  // A real read is a snapshot: the claim that follows must not change what the reviewer loaded.
  pullRequest: { findUnique: async () => crashRecovery ? { ...pr } : pr, count: async () => 1,
    findFirst: async () => retryBlock === "superseded" ? null : { id: pr.id, repository: { organization: { reviewsPaused: false } } }, updateMany: async (query: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
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
};
mock.module("@octopus/db", () => ({ prisma: db }));
mock.module("@/lib/embeddings", () => ({ createEmbeddings: async (texts: string[]) => {
  if (embeddingErrorPrivacy) {
    embeddingCalls++;
    if (embeddingCancelPrivacy) { adaptiveAbort.abort(new Error("synthetic-embedding-private")); throw adaptiveAbort.signal.reason; }
    throw Object.assign(new Error("synthetic-embedding-private"), { status: 503 });
  }
  if (bestEffortPrivacy && (((failureSite === "feedback-embedding" || failureSite === "suppression-embedding") && texts[0].startsWith(feedbackIssue.title)) || (failureSite === "review-embedding" && texts[0].includes("### Summary")) || (failureSite === "diagram-embedding" && texts[0].includes("for PR #")))) throw privateFailure();
  return texts.map(() => [1, 0, 0]);
} }));
mock.module("@/lib/qdrant", () => ({
  searchSimilarChunks: async () => [], searchKnowledgeChunks: async () => [], searchReviewChunks: async () => [],
  searchFeedbackPatterns: async () => [], ensureFeedbackCollection: async () => { if (failureSite === "feedback-storage") throw privateFailure(); },
  ensureReviewCollection: async () => { if (failureSite === "review-storage") throw privateFailure(); }, upsertReviewChunks: async () => {}, deleteReviewChunksByPR: async () => {},
  ensureDiagramCollection: async () => { if (failureSite === "diagram-storage") throw privateFailure(); }, upsertDiagramChunk: async () => {}, deleteDiagramChunksByPR: async () => {},
  upsertFeedbackPattern: async () => {},
}));
mock.module("@/lib/reranker", () => ({ rerankDocuments: async () => [] }));
mock.module("@/lib/knowledge-context", () => ({ getAlwaysIncludeKnowledge: async () => [], mergeKnowledgeChunks: () => [] }));
mock.module("@/lib/review-routing", () => ({ resolveReviewModel: async () => refusalFlow ? "claude-sonnet-4-6" : adaptiveStage ? "claude-fable-5-1" : "gpt-fixture" }));
mock.module("@/lib/ai-usage", () => ({ logAiUsage: async (usage: { operation: string; usageUnknown?: boolean; chargeKey?: string }) => {
  // A failed attempt is recorded with unknown usage and is never a customer debit.
  if (usage.usageUnknown) { unknownUsage.push(usage.operation); return; }
  if (usage.chargeKey) chargeKeys.push(usage.chargeKey);
  usageCount++; usageOperations.push(usage.operation); if (adaptiveStage === "before-validator") adaptiveAbort.abort(); } }));
mock.module("@/lib/ai-router", () => ({ credentialRouteUnchanged: async () => { if (retryBlock === "key-cancelled") retryAbort.abort(); return retryBlock !== "key"; }, getProviderForModel: async () => {
  assert.ok(adaptiveStage, "Legacy fixture must not resolve adaptive capacity"); return "anthropic";
}, createAiMessage: async (params: AiCreateParams) => {
  if (generationSetupErrorPrivacy) throw privateFailure();
  if (bestEffortPrivacy && failureSite === "followup" && ++privacyGenerationCalls > 1) throw privateFailure();
  if (bestEffortPrivacy && failureSite === "classifier" && params.model === "claude-sonnet-5") return { provider: "openai", usedOwnKey: false, text: '["synthetic-secret req_syntheticprivate123",]', usage: { inputTokens: 1, outputTokens: 1 } };
  if (localClassification && localFailure) {
    const { AiProviderFailure } = await import("@/lib/provider-failure");
    if (localFailure.throwValue) throw localFailure.message;
    if (localFailure.unwrapped) throw new Error(localFailure.message);
    if (localFailure.provider === "local") {
      const { localProvider } = await import("@/lib/providers/local");
      try { return await localProvider.create(params, null, "org"); }
      catch (error) { throw new AiProviderFailure(error, "local", params.model, "unknown"); }
    }
    throw new AiProviderFailure(Object.assign(new Error(localFailure.message), { status: localFailure.status, name: localFailure.name ?? "Error", cause: localFailure.code ? { code: localFailure.code } : undefined }), localFailure.provider, params.model, localFailure.keyOwner ?? "organization");
  }
  if (localClassification) return { model: params.model, provider: "openai", text: report, usage: { inputTokens: 1, outputTokens: 1 } };
  // Only the primary review request disables SDK retries; follow-up calls take the ordinary path below.
  if (generationDiagnostic && params.maxRetries === 0) {
    const { AiProviderFailure } = await import("@/lib/provider-failure");
    const outcome = generationScript.shift() ?? generationFailure;
    // Provider setup fails before any request is sent.
    if (outcome === "setup") throw new Error("synthetic-setup-secret");
    generationDispatches++;
    if (outcome !== "success") {
      if (recordRequests) params.onRequest?.({ provider: "openai", model: params.model, sha256: "fixture", inputPreserved: true });
      // The job deadline passes while the provider is still generating.
      if (outcome === "deadline") { retryAbort.abort(new DOMException("fixture", "TimeoutError")); await new Promise(() => {}); }
      retryBlock = pendingRetryBlock;
      if (retryBlock === "cancelled") retryAbort.abort(new DOMException("fixture", "AbortError"));
      const raw = Object.assign(new Error("synthetic-generation-secret"), { status: { terminated: 503, unavailable: 503, "organization-auth": 401, "rate-limit": 429, unknown: undefined }[outcome],
        request_id: "req_syntheticgenerationsecret", cause: { message: outcome === "terminated" ? "terminated" : "synthetic private" },
        ...(["rate-limit", "unavailable"].includes(outcome) ? { headers: new Headers({ "retry-after": retryAfterHeader }) } : {}) });
      throw new AiProviderFailure(raw, "openai", params.model, outcome === "organization-auth" ? "organization" : "platform");
    }
  }
  if (providerErrorPrivacy) {
    const { AiProviderFailure } = await import("@/lib/provider-failure");
    throw new AiProviderFailure(Object.assign(new Error("synthetic-credential-and-prompt"), { status: 401 }), "openai", params.model, "organization");
  }
  if (refusalFlow) {
    const { anthropicProvider } = await import("@/lib/providers/anthropic");
    const { AiProviderFailure } = await import("@/lib/provider-failure");
    try { return await anthropicProvider.create(params, "synthetic-key"); }
    catch (error) { throw new AiProviderFailure(error, "anthropic", params.model, "platform"); }
  }
  if (adaptiveStage) {
    assert.ok(params.completeReviewAdmission, "Oversized complete input must use capacity admission");
    const { observeAiRequest } = await import("@/lib/providers/request-evidence");
    const { capacityReceipt, refuseCapacity } = await import("@/lib/review-capacity");
    const receipt = capacityReceipt(params.completeReviewAdmission, params.model);
    if (adaptiveStage === "admission") {
      if (capacityAbort === "expired") { adaptiveRemaining = 0; adaptiveAbort.abort(); }
      else if (capacityAbort) adaptiveAbort.abort(new DOMException("fixture", capacityAbort === "timeout" ? "TimeoutError" : "AbortError"));
      refuseCapacity(params.completeReviewAdmission, receipt, capacityReason);
    }
    receipt.state = "admitted"; receipt.primaryDispatch = "started";
    params.completeReviewAdmission.onDecision?.(receipt);
    observeAiRequest(params, "anthropic", { model: params.model, messages: params.messages });
    if (adaptiveStage === "generation-cancel" || adaptiveStage === "generation-timeout" || adaptiveStage === "generation-expired") {
      if (adaptiveStage === "generation-expired") { adaptiveRemaining = 0; adaptiveAbort.abort(); }
      else adaptiveAbort.abort(new DOMException("fixture", adaptiveStage === "generation-timeout" ? "TimeoutError" : "AbortError"));
      throw new Error("Provider interrupted");
    }
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
    if (bestEffortPrivacy && failureSite === "validation") throw privateFailure();
    if (adaptiveStage === "during-validator") adaptiveAbort.abort();
    if (adaptiveStage === "expired-validator") { adaptiveRemaining = 0; adaptiveAbort.abort(); }
    return findings;
  },
}));

// Hosted review integration: keep generation, parsing, suppression and finding
// persistence mapping real; replace external services and unrelated prerequisites.
const archived: { id: string; findings: { title: string }[]; coverage: unknown; body: string }[] = [];
const summaries: string[] = [];
const published: { body: string; comments: unknown[] }[] = [];
const checkConclusions: string[] = [];
const checkOutputs: unknown[] = [];
mock.module("@/lib/review-summary-comment", () => ({ publishReviewSummary: async (target: { body: string; headSha: string; reviewRequestVersion: number; expectedReviewBody?: string; executionWindow?: ReviewExecutionWindow }) => {
  if ((publicationErrorPrivacy || (generationRetry && failureSite === "retry-publication")) && target.expectedReviewBody !== undefined) throw privateFailure();
  if (peerAlreadyIndexed && target.body.includes("Repository already indexed")) throw new Error("synthetic-secret peer comment");
  if (target.body.includes("Indexing in progress")) {
    assert.ok(repo.indexAttemptId, "Preparation must already own the claim");
    if (indexPreparation === "fail") throw new Error("Index setup failed");
    if (indexPreparation === "replace" || indexPreparation === "replace-success") {
      repo.indexStatus = "indexing";
      repo.indexAttemptId = "replacement-attempt";
      if (indexPreparation === "replace") throw new Error("Cancelled setup resumed after restart");
    }
  }
  if (firstCompletion && pr.status === "completed" && completionFailure === "summary") {
    completionFailure = null;
    assert.equal(pr.firstReviewCompletedAt, null, "Archiving the result must not complete onboarding before publication");
    throw new Error("Fixture final summary publication failed");
  }
  if (target.expectedReviewBody !== undefined) {
    leaseHeldWhilePublishing = (deliveries.get(archived.at(-1)!.id)?.leaseUntil ?? new Date(0)) > new Date();
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
  recordInterruptedAttempt: async (stopped: { reviewAttemptId: string | null }) => { interruptedAttempts.push(stopped.reviewAttemptId); },
  withForgejoReviewPublication: directCommentFailure ? realReviewAttempt.withForgejoReviewPublication : async (_id: string, _head: string, _version: number, publish: () => Promise<void>) => publish(),
  createReviewAttemptComment: directCommentFailure ? realReviewAttempt.createReviewAttemptComment : async (_id: string, _head: string, _version: number, create: () => Promise<number>) => create(),
  updateCurrentReview: indexingPrivacy || preparationDiagnostic || generationDiagnostic || directCommentFailure || firstCompletion || refusalFlow || providerErrorPrivacy || embeddingErrorPrivacy || publicationErrorPrivacy || generationSetupErrorPrivacy ? realReviewAttempt.updateCurrentReview : async () => ({ count: 1 }),
  saveReviewAttempt: async (_id: string, _pr: string, _coverage: unknown, _body: string, findings: { title: string }[]) => {
    archived.push({ id: _id, findings, coverage: structuredClone(_coverage), body: _body });
    if (firstCompletion) Object.assign(pr, { status: "completed", reviewBody: _body });
    if (adaptiveStage === "after-save" && (_coverage as ReviewCoverage).assessment?.state === "completed") adaptiveAbort.abort();
    if ((_coverage as ReviewCoverage).assessment?.state === "completed") completedSnapshot = JSON.stringify(archived.at(-1));
    return firstCompletion || !!adaptiveStage || bestEffortPrivacy;
  },
}));
mock.module("@/lib/github", () => ({
  LargePrError: FixtureLargePrError,
  getPullRequestReviewInput: async () => { if (preparationFetchFailure === "large_pr") throw new FixtureLargePrError(); if (preparationFetchFailure === "review_input") throw Object.assign(new Error("synthetic private input"), { status: 503, request_id: "req_syntheticprivate123" }); return { rawDiff: diff, input: {
    provider: "github", headSha: pr.headSha, baseSha: "b".repeat(40), inventoryComplete: true,
    expectedFiles: 1, limitations: [],
    files: [{ path: "src/check.ts", change: "modified", patch: `@@ -1 +1 @@\n-return value;\n+return value.name;${adaptiveStage ? " ".repeat(400000) : ""}\n`, additions: 1, deletions: 1 }],
  } }; },
  getPullRequestDetails: async () => { if (bestEffortPrivacy && failureSite === "pr-body-fetch") throw privateFailure(); return { body: "Handle missing values", headSha: retryBlock === "head" ? "c".repeat(40) : pr.headSha, baseSha: "b".repeat(40) }; },
  createPullRequestComment: async () => { directComments++; return 123; },
  updatePullRequestComment: async (_installation: number, _owner: string, _repo: string, _id: number, body: string) => { summaries.push(body); },
  createPullRequestReview: async (_installation: number, _owner: string, _repo: string, _number: number, body: string, _event: string, comments: unknown[]) => {
    reviewAttempts.push(comments.length);
    if (bestEffortPrivacy && failureSite === "inline-review" && comments.length) throw Object.assign(new Error("synthetic-best-effort-private"), { status: 403, request_id: "req_syntheticprivate123" });
    if (bestEffortPrivacy && failureSite === "review-fallback") throw privateFailure();
    if (nativeFailure) throw new Error("fixture native review rejected");
    published.push({ body, comments });
    return 456;
  },
  createCheckRun: async () => { if (bestEffortPrivacy && failureSite === "check-run") throw privateFailure(); return 789; },
  updateCheckRun: async (_installation: number, _owner: string, _repo: string, _id: number, conclusion: string, _output: unknown, window?: ReviewExecutionWindow) => {
    if (firstCompletion && completionFailure === "check") { completionFailure = null; throw new Error("Fixture final check publication failed"); }
    if (window && adaptiveStage === "check-send") await fetch("https://synthetic.invalid/check", { signal: window.signal });
    checkConclusions.push(conclusion);
    checkOutputs.push(_output);
  },
  getRepositoryTree: async () => { if (preparationFetchFailure === "repository_tree") throw Object.assign(new Error("synthetic private tree"), { status: 503, request_id: "req_syntheticprivate123" }); return ["src/check.ts"]; },
  getFileContent: async () => "return value.name;",
  listReviewComments: async () => { if (bestEffortPrivacy && failureSite === "match-ids") throw privateFailure(); return []; },
  listPullRequestReviewComments: async () => (feedbackMode === "reply" || feedbackMode === "classifier-reply") ? [{ id: 6, user: "fixture", body: feedbackMode === "reply" ? "👎" : "Please reconsider this finding", inReplyToId: 5 }] : [{ id: 5, user: "fixture[bot]", path: "src/check.ts", line: 1, body: "🟠 Previous unrelated partial-review issue", inReplyToId: null }],
  listPullRequestIssueComments: async () => feedbackMode === "per-finding" ? [{ user: "fixture", createdAt: new Date().toISOString(), body: "**Missing null check** — 👎" }] : (feedbackMode === "bulk" || feedbackMode === "classifier-bulk") ? [{ user: "fixture", createdAt: new Date().toISOString(), body: feedbackMode === "bulk" ? "👎" : "Please reconsider these findings" }] : [],
  listPullRequestReviews: async () => { if (bestEffortPrivacy && failureSite === "prior-reviews") throw privateFailure(); return priorBotReviews; },
  getCommentReactions: async () => ({ thumbsUp: feedbackMode === "reaction" ? 1 : 0, thumbsDown: 0 }),
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
mock.module("@/lib/bitbucket", () => ({
  getPullRequestReviewInput: async () => ({ rawDiff: diff, input: {
    provider: "bitbucket", headSha: pr.headSha, baseSha: "b".repeat(40), inventoryComplete: true,
    expectedFiles: 1, limitations: [],
    files: [{ path: "src/check.ts", change: "modified", patch: "@@ -1 +1 @@\n-return value;\n+return value.name;\n", additions: 1, deletions: 1 }],
  } }),
  getPullRequestDetails: async () => ({ body: "Handle missing values" }),
  getRepositoryTree: async () => ["src/check.ts"],
  getFileContent: async () => "return value.name;",
  createPullRequestComment: async (_org: string, _owner: string, _repo: string, _number: number, body: string) => { summaries.push(body); return 123; },
  updatePullRequestComment: async (_org: string, _owner: string, _repo: string, _number: number, _id: number, body: string) => { summaries.push(body); },
}));
mock.module("@/lib/gitlab", () => ({
  getBranchHead: async () => { if (bestEffortPrivacy && failureSite === "branch-head") throw privateFailure(); return bestEffortPrivacy && failureSite === "tree-cache" ? "b".repeat(40) : null; },
  getPullRequestReviewInput: async () => ({ rawDiff: diff, input: {
    provider: "gitlab", headSha: pr.headSha, baseSha: "b".repeat(40), inventoryComplete: true,
    expectedFiles: 1, limitations: [],
    files: [{ path: "src/check.ts", change: "modified", patch: `@@ -1 +1 @@\n-return value;\n+return value.name;${embeddingErrorPrivacy || bestEffortPrivacy ? "" : " ".repeat(400000)}\n`, additions: 1, deletions: 1 }],
  } }),
  getPullRequestDetails: async () => ({ body: "Handle missing values" }),
  getFileContent: async () => "return value.name;",
  getRepositoryTree: async () => ["src/check.ts"],
  listPullRequestComments: async () => [],
  createPullRequestComment: async (_org: string, _project: string, _number: number, body: string) => { if (preparationDiagnostic && failureSite === "initial-comment") throw privateFailure(); summaries.push(body); return 123; },
  updatePullRequestComment: async (_org: string, _project: string, _number: number, _id: number, body: string) => { summaries.push(body); },
  createInlineComment: async () => { if (bestEffortPrivacy && failureSite === "project-inline") throw privateFailure(); return 456; },
  setCommitStatus: async (_org: string, _project: string, _sha: string, state: string, _name: string, _description: string, _url?: string, window?: ReviewExecutionWindow) => {
    if (bestEffortPrivacy && failureSite === "running-status" && state === "running") throw privateFailure();
    if (bestEffortPrivacy && failureSite === "final-status" && state === "success") throw privateFailure();
    if (window) {
      await Promise.resolve();
      if (adaptiveStage === "gitlab-auth") adaptiveAbort.abort();
      if (adaptiveStage === "gitlab-transport-control") throw new Error("Unrelated status error");
      assertReviewProcessingActive(window);
    }
    checkConclusions.push(state);
    checkOutputs.push(_description);
  },
}));
mock.module("@/lib/github-app-config", () => ({ getGithubAppConfig: async () => ({ slug: "fixture" }) }));
mock.module("@/lib/queue", () => ({
  loadQueueConfig: async () => ({ reviewTimeoutSeconds: 60, largeReviewTimeoutSeconds: 60 }),
  computeStaleReclaimMs: () => 120000,
  enqueue: async (name: string) => { queuedJobs.push(name); }, enqueueAfter: async (...job: unknown[]) => { delayedJobs.push(job); },
}));
mock.module("@/lib/cost", () => ({ getOrgSpendLimitStatus: async () => retryBlock === "spend" ? { blocked: true, reason: "no_credits" } : { blocked: false }, shouldGuardConcurrency: async () => retryBlock === "guard", getModelPricing: async () => null, estimateCompleteReviewCost: () => 0 }));
mock.module("@/lib/pubby", () => ({ pubby: { trigger: async (_channel: string, _name: string, data: { status?: string; message?: string }) => { if (bestEffortPrivacy && failureSite === "pubby") throw privateFailure(); events.push({ ...data, status: _name === "index-status" ? repo.indexStatus : data.status, eventName: _name }); } } }));
mock.module("@/lib/events", () => ({ eventBus: { emit: (event: { type: string }) => { events.push(event); } } }));
mock.module("@/lib/indexer", () => ({ indexRepository: async (_scope: unknown, _name: string, _branch: string, _installation: number, emit: (message: string) => void) => {
  if (indexingPrivacy) { indexingCalls++; throw new Error("synthetic-secret clone /private/path"); }
  if (!preserveAutoReview) throw new Error("unexpected indexing");
  indexingCalls++;
  emit("Processed 5 files, skipped 0");
  emit("Error /private/path synthetic-token");
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
if (localClassification) {
  const { generateLocalReview, generateBareLocalReview, ReviewConfigError } = await import("@/lib/review-core");
  const { AiProviderFailure } = await import("@/lib/provider-failure");
  assert.equal(new AiProviderFailure(new Error("synthetic-secret"), "local", "local:model", "unknown").message, "AI provider local request failed");
  // The adapter preserves connection-specific evidence through the SDK.
  const { APIConnectionError, APIConnectionTimeoutError } = await import("openai/error");
  const connectTimeout = new APIConnectionError({ cause: Object.assign(new Error("Connection failed"), { code: "UND_ERR_CONNECT_TIMEOUT" }) });
  assert.equal(new AiProviderFailure(connectTimeout, "ollama", "ollama:model", "unknown").reviewCategory, "local");
  assert.equal(new AiProviderFailure(new APIConnectionTimeoutError(), "ollama", "ollama:model", "unknown").reviewCategory, undefined);
  const paths = [() => generateLocalReview({ diff, repoId: "repo", orgId: "org" }), () => generateBareLocalReview({ diff, orgId: "org" })];
  for (const run of paths) {
    for (const failure of [
      { provider: "openai" as const, message: "invalid_api_key synthetic-secret" },
      { provider: "ollama" as const, message: "fetch failed synthetic-secret" },
      { provider: "openai" as const, message: "synthetic-secret", status: 401 },
    ]) {
      localFailure = failure;
      await assert.rejects(run, (error: Error) => error instanceof ReviewConfigError && !error.message.includes("synthetic-secret"));
    }
    for (const failure of [
      { provider: "openai" as const, message: "fetch failed synthetic-secret", keyOwner: "organization" as const },
      { provider: "openai" as const, message: "synthetic-secret", status: 401, keyOwner: "platform" as const },
      { provider: "openai" as const, message: "synthetic-secret", status: 403, keyOwner: "unknown" as const },
      { provider: "openai" as const, message: "synthetic-secret", status: 429, keyOwner: "organization" as const },
      { provider: "openai" as const, message: "synthetic-secret", status: 429, keyOwner: "platform" as const },
      { provider: "ollama" as const, message: "synthetic-secret", status: 500, keyOwner: "unknown" as const },
    ]) {
      localFailure = failure;
      await assert.rejects(run, (error: Error) => error instanceof AiProviderFailure && !(error instanceof ReviewConfigError) && !error.message.includes("synthetic-secret"));
    }
    for (const message of ["invalid_api_key synthetic-secret", "fetch failed synthetic-secret"]) {
      localFailure = { provider: "openai", message, unwrapped: true };
      await assert.rejects(run, (error: Error) => !(error instanceof ReviewConfigError) && !error.message.includes("synthetic-secret"));
    }
    localFailure = { provider: "openai", message: "synthetic-secret", throwValue: true };
    await assert.rejects(run, (error: Error) => error.message === "Review generation failed");
    localFailure = { provider: "local", message: "" };
    await assert.rejects(run, (error: Error) => !(error instanceof ReviewConfigError) && error.message === "No local agent is online for this organisation. Run `octp agent serve` on a machine with the API token.");
    localFailure = { provider: "openai", message: "synthetic-secret" };
    await assert.rejects(run, (error: Error) => !(error instanceof ReviewConfigError) && !error.message.includes("synthetic-secret"));
    localFailure = null;
    assert.equal((await run()).usage.inputTokens, 1);
  }
  mock.module("@/lib/api-auth", () => ({ authenticateApiToken: async () => ({ org, user: null }) }));
  mock.module("@/lib/cost", () => ({ isOrgOverSpendLimit: async () => false }));
  mock.module("@/lib/external-review-activity", () => ({ withExternalReviewActivity: async (_info: unknown, run: () => Promise<Response>) => run() }));
  mock.module("@/lib/audit", () => ({ writeAuditLog: async () => {} }));
  mock.module("next/headers", () => ({ headers: async () => new Headers() }));
  const bare = await import("../../../app/api/cli/review-local/route");
  const contextual = await import("../../../app/api/cli/repos/[id]/local-review/route");
  const { NextRequest } = await import("next/server");
  const originalError = console.error;
  const originalEnv = process.env.NODE_ENV;
  const routeLogs: string[] = [];
  console.error = (...args: unknown[]) => { routeLogs.push(inspect(args)); };
  process.env.NODE_ENV = "production";
  try {
    for (const route of [
      () => bare.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ diff }) })),
      () => contextual.POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ diff }) }), { params: Promise.resolve({ id: repo.id }) }),
    ]) {
      localFailure = { provider: "openai", message: "synthetic-secret", status: 401, keyOwner: "organization" };
      const organizationFailure = await route();
      assert.equal(organizationFailure.status, 422);
      assert.match((await organizationFailure.json()).error, /credentials or access/);
      for (const code of ["ECONNREFUSED", "ENETUNREACH", "EAI_AGAIN", "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT"]) {
        localFailure = { provider: "ollama", message: "Connection error. synthetic-secret", code, keyOwner: "unknown" };
        const response = await route();
        assert.equal(response.status, 422);
        assert.match((await response.json()).error, /Could not reach the configured local model/);
      }
      for (const failure of [
        { provider: "ollama" as const, message: "response timed out synthetic-secret", code: "ETIMEDOUT" },
        { provider: "openai" as const, message: "synthetic-secret", status: 401, keyOwner: "platform" as const },
        { provider: "openai" as const, message: "rate limit exceeded for API key synthetic-secret", status: 429, keyOwner: "organization" as const },
        { provider: "openai" as const, message: "rate limit exceeded for API key synthetic-secret", status: 429, keyOwner: "platform" as const },
        { provider: "openai" as const, message: "service error for API key synthetic-secret", status: 500, keyOwner: "organization" as const },
        { provider: "openai" as const, message: "API key request cancelled synthetic-secret", name: "AbortError", keyOwner: "organization" as const },
        { provider: "openai" as const, message: "fetch failed synthetic-secret", keyOwner: "unknown" as const },
        { provider: "openai" as const, message: "Connection error. synthetic-secret", code: "ENETUNREACH" },
        { provider: "openai" as const, message: "Connection error. synthetic-secret", code: "ENOTFOUND" },
        { provider: "ollama" as const, message: "Connection error. synthetic-secret", code: "ENOTFOUND", status: 500 },
        { provider: "ollama" as const, message: "Connection error. synthetic-secret", code: "ENOTFOUND", name: "AbortError" },
        { provider: "ollama" as const, message: "fetch failed synthetic-secret", status: 500 },
        { provider: "ollama" as const, message: "fetch failed synthetic-secret", code: "UND_ERR_BODY_TIMEOUT" },
        { provider: "ollama" as const, message: "fetch failed synthetic-secret", code: "ECONNRESET" },
        { provider: "ollama" as const, message: "fetch failed synthetic-secret", name: "AbortError" },
        { provider: "ollama" as const, message: "Request timed out. synthetic-secret", name: "APIConnectionTimeoutError" },
        { provider: "ollama" as const, message: "Connection error. synthetic-secret", name: "APIConnectionError", code: "ETIMEDOUT", status: 500 },
        { provider: "ollama" as const, message: "Connection error. synthetic-secret", name: "AbortError", code: "ETIMEDOUT" },
        { provider: "openai" as const, message: "Connection error. synthetic-secret", name: "APIConnectionError", code: "ETIMEDOUT" },
      ]) {
        localFailure = failure;
        const response = await route();
        assert.equal(response.status, 500);
        assert.equal((await response.json()).error, "Review generation failed");
      }
    }
    assert.doesNotMatch(routeLogs.join("\n"), /synthetic-secret/);
  } finally {
    console.error = originalError;
    process.env.NODE_ENV = originalEnv;
  }
  process.exit(0);
}
const { processReview } = await import("@/lib/reviewer");
if (generationRetry) {
  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  const interruptedTwice = "Review generation was interrupted twice and was not completed. No score was produced. Comment `@octopus-review` to run it again.";
  const run = async (script: GenerationOutcome[], options: { block?: RetryBlock; remaining?: number; retryAfter?: string; budget?: number; unrecorded?: boolean } = {}) => {
    generationScript.length = 0; generationScript.push(...script);
    pendingRetryBlock = options.block ?? ""; retryBlock = ""; retryAbort = new AbortController(); retryAfterHeader = options.retryAfter ?? "1"; recordRequests = !options.unrecorded;
    generationBudget.claims = 0; generationBudget.limit = options.budget ?? Infinity;
    pr.status = "pending";
    summaries.length = 0; checkOutputs.length = 0; unknownUsage.length = 0; chargeKeys.length = 0; usageOperations.length = 0;
    const dispatches = generationDispatches, attempts = archived.length, started = performance.now();
    await processReview("pr", { jobId: "fixture", deadlineEpochMs: Date.now() + 900000, signal: retryAbort.signal, remainingMs: () => options.remaining ?? 900000 });
    const assessment = (archived.at(-1)?.coverage as ReviewCoverage | undefined)?.assessment as { state: string; requests: unknown[];
      failure?: { code: string; retryability: string }; attempts?: { failure: { code: string; retryability: string }; requests: unknown[] }[] } | undefined;
    return { dispatches: generationDispatches - dispatches, archived: archived.length - attempts, elapsedMs: performance.now() - started, assessment,
      debits: usageOperations.filter(operation => operation === "review").length, body: summaries.at(-1) ?? "", check: inspect(checkOutputs), attemptId: archived.at(-1)?.id ?? "" };
  };
  try {
    let result = await run(["terminated", "success"]);
    assert.equal(result.dispatches, 2, "one transient failure is retried once");
    assert.equal(result.assessment?.state, "completed");
    assert.equal(result.assessment?.failure, undefined);
    assert.equal(result.assessment?.requests.length, 1, "completeness is evaluated on the final attempt");
    assert.deepEqual(result.assessment?.attempts?.map(attempt => [attempt.failure.code, attempt.failure.retryability]), [["STREAM_TERMINATED", "transient"]]);
    assert.equal(result.archived, 1);
    assert.equal(summaries.filter(body => body.includes("**4/5**")).length, 1, "one final published review");
    assert.equal(result.debits, 1, "the successful generation is charged exactly once");
    assert.deepEqual(chargeKeys, [`review-generation:${pr.id}:${pr.reviewRequestVersion}:${pr.headSha}`]);
    assert.deepEqual(unknownUsage, ["review-failed-attempt"], "the failed attempt is recorded with unknown usage");
    assert.doesNotMatch(inspect({ summaries, checkOutputs }), /retrying|interrupted twice/i);

    failureSite = "retry-publication";
    result = await run(["terminated", "success"]);
    assert.equal(result.dispatches, 2);
    assert.doesNotMatch(inspect({ summaries, checkOutputs }), /interrupted twice/i, "publication failure after a successful retry is not a second generation failure");
    failureSite = "";

    result = await run(["terminated", "terminated"]);
    assert.equal(result.dispatches, 2, "the retry is not repeated");
    assert.equal(result.assessment?.state, "incomplete");
    assert.deepEqual([result.assessment?.attempts?.length, result.assessment?.attempts?.[0].failure.code, result.assessment?.failure?.code], [1, "STREAM_TERMINATED", "STREAM_TERMINATED"]);
    assert.equal(result.archived, 1, "both attempts are kept in one immutable record");
    for (const output of [result.body, result.check]) {
      assert.ok(output.includes(interruptedTwice), "terminal text after an exhausted retry");
      assert.ok(output.includes("Failure code: `STREAM_TERMINATED`.") && output.includes(result.attemptId));
      assert.doesNotMatch(output, /retrying/i);
    }
    assert.ok(!/\|[^\n]*[1-5]\/5/.test(result.body), "no score from a failed generation");
    assert.equal(result.debits, 0, "failed attempts are never a customer debit");
    assert.deepEqual(unknownUsage, ["review-failed-attempt", "review-failed-attempt"]);

    for (const outcome of ["organization-auth", "unknown"] as const) {
      result = await run(["terminated", outcome]);
      assert.equal(result.dispatches, 2);
      for (const output of [result.body, result.check]) {
        assert.ok(output.includes(interruptedTwice));
        assert.ok(output.includes(`Failure code: \`${outcome === "unknown" ? "unclassified" : "http_401"}\`.`));
      }
    }

    result = await run(["terminated", "organization-auth"], { unrecorded: true });
    assert.equal(result.dispatches, 2);
    for (const output of [result.body, result.check]) {
      assert.ok(output.includes(interruptedTwice), "two failed generations are reported without a request receipt");
      assert.ok(output.includes("Failure code: `http_401`."));
    }

    result = await run(["terminated", "deadline"]);
    assert.equal(result.dispatches, 2);
    assert.deepEqual([result.assessment?.failure?.code, result.assessment?.attempts?.length], ["ETIMEDOUT", 1], "a retry cut off by the deadline keeps a safe code");
    for (const output of [result.body, result.check]) {
      assert.ok(output.includes(interruptedTwice));
      assert.ok(output.includes("Failure code: `ETIMEDOUT`.") && output.includes(result.attemptId));
    }

    result = await run(["terminated", "setup"]);
    assert.equal(result.dispatches, 1, "the retry never reached the provider");
    for (const output of [result.body, result.check]) {
      assert.ok(!output.includes("interrupted twice"), "a retry that never started is not a second failure");
      assert.ok(output.includes("Failure code: `STREAM_TERMINATED`."), "the original failure code stands");
      assert.doesNotMatch(output, /synthetic-setup-secret/);
    }

    result = await run(["organization-auth"]);
    assert.equal(result.dispatches, 1, "an organization-level rejection is never retried");
    assert.ok(!result.body.includes("interrupted twice"));
    assert.equal(generationBudget.limit, 0, "a permanent failure uses up the durable budget");
    result = await run(["unknown"]);
    assert.equal(result.dispatches, 1, "an unknown cause is never retried");
    assert.equal(result.assessment?.failure?.retryability, "unknown");
    assert.equal(generationBudget.limit, 0, "an unknown failure uses up the durable budget");

    result = await run(["rate-limit", "success"], { retryAfter: "2" });
    assert.equal(result.dispatches, 2, "a platform-key 429 is retried after its Retry-After");
    assert.ok(result.elapsedMs >= 1900, `waited for Retry-After (${result.elapsedMs}ms)`);
    assert.equal(result.debits, 1);
    result = await run(["rate-limit", "success"], { retryAfter: "900" });
    assert.equal(result.dispatches, 1, "a Retry-After that does not fit the job is not waited for");
    assert.equal(result.assessment?.failure?.code, "http_429");

    result = await run(["unavailable", "success"], { retryAfter: "900" });
    assert.equal(result.dispatches, 1, "a 503 Retry-After that does not fit must prevent the retry");

    result = await run(["terminated", "success"], { remaining: 200_000 });
    assert.equal(result.dispatches, 1, "too little of the job window is left");
    assert.equal(generationBudget.limit, Infinity, "a transient failure leaves the remaining budget for a later delivery");
    for (const block of ["head", "superseded", "cancelled", "key", "access", "spend", "guard"] as const) {
      result = await run(["terminated", "success"], { block });
      assert.equal(result.dispatches, 1, `no second dispatch after: ${block}`);
      assert.deepEqual([result.assessment?.failure?.code, result.assessment?.attempts], ["STREAM_TERMINATED", undefined], `the original failure stands: ${block}`);
      assert.equal(result.debits, 0);
      assert.ok(!result.body.includes("interrupted twice"), block);
    }

    result = await run(["terminated", "success"], { block: "key-cancelled" });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(result.dispatches, 1);
    assert.equal(generationBudget.claims, 1, "cancellation during credential lookup leaves the retry unit available");

    result = await run(["terminated", "success"], { budget: 1 });
    assert.equal(result.dispatches, 1, "a used-up durable budget refuses the retry");
    result = await run(["success"], { budget: 0 });
    assert.equal(result.dispatches, 0, "a used-up durable budget refuses a redelivered generation");
    assert.ok(reviewUpdates.some(update => (update as { data: { errorMessage?: string } }).data.errorMessage === "Review failed during generation"));
    assert.doesNotMatch(inspect({ errors, summaries, checkOutputs, reviewUpdates, events, archived, sentryEvents }, { depth: 20 }), /synthetic-generation-secret|req_syntheticgenerationsecret/);
  } finally { console.error = originalError; }
  console.log("PASS transient generation failures are retried once within review limits");
  process.exit(0);
}
if (generationDiagnostic) {
  const originalError = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    for (const [scenario, code, keyOwner, status, retryability] of [
      ["terminated", "STREAM_TERMINATED", "platform", 503, "transient"],
      ["organization-auth", "http_401", "organization", 401, "permanent"],
    ] as const) {
      generationFailure = scenario;
      pr.status = "pending";
      summaries.length = 0; checkOutputs.length = 0; reviewUpdates.length = 0; events.length = 0; errors.length = 0; sentryEvents.length = 0;
      const beforeCalls = generationDispatches, beforeUsage = usageCount;
      await processReview("pr", { jobId: "fixture", deadlineEpochMs: Date.now() + 900000, signal: new AbortController().signal, remainingMs: () => 900000 });
      const attempt = archived.at(-1)!;
      const coverage = attempt.coverage as ReviewCoverage;
      const failure = coverage.assessment as { state: string; attempts?: unknown[]; failure?: { stage: string; code: string; keyOwner: string; ownership: string; retryability: string; status?: number } };
      assert.equal(coverage.complete, true);
      assert.equal(failure.state, "incomplete");
      assert.deepEqual(failure.failure, { stage: "generation", code, keyOwner, ownership: keyOwner, retryability, status });
      assert.equal(coverage.reviewRequestVersion, pr.reviewRequestVersion);
      assert.equal(coverage.headSha, pr.headSha);
      assert.ok(summaries.at(-1)?.includes("review generation failed"));
      assert.ok(inspect(checkOutputs).includes("Review generation failed"));
      for (const output of [summaries.at(-1) ?? "", inspect(checkOutputs)]) {
        assert.ok(output.includes(`Failure code: \`${code}\`.`) && output.includes(attempt.id), "the failure code is shown next to the attempt ID");
      }
      assert.ok(!/\|[^\n]*[1-5]\/5/.test(summaries.at(-1) ?? ""));
      assert.equal(generationDispatches, beforeCalls + (retryability === "transient" ? 2 : 1), "only a transient failure is retried, once");
      assert.equal(failure.attempts?.length, retryability === "transient" ? 1 : undefined);
      assert.equal(usageCount, beforeUsage, "a failed generation is never a customer debit");
      assert.doesNotMatch(inspect({ errors, summaries, checkOutputs, reviewUpdates, events, archived, sentryEvents }, { depth: 20 }), /synthetic-generation-secret|req_syntheticgenerationsecret/);
      if (scenario === "terminated") {
        assert.equal(sentryEvents.at(-1)?.tags?.failure_code, code);
        assert.equal(sentryEvents.at(-1)?.contexts?.background_failure?.attemptId, attempt.id);
      }
    }
    const { executeCoveredReview } = await import("@/lib/review-assessment");
    const { AiProviderFailure } = await import("@/lib/provider-failure");
    const { reviewCheckResult } = await import("@/lib/review-coverage");
    const input = { model: "gpt-fixture", maxTokens: 10, messages: [{ role: "user" as const, content: "fixture" }] };
    const unknown = new AiProviderFailure(new Error("synthetic-generation-secret"), "openai", "gpt-fixture", "unknown");
    Object.assign(unknown.details, { code: "synthetic-generation-secret", status: 999, requestId: "req_syntheticgenerationsecret" });
    Object.assign(unknown, { keyOwner: "synthetic-generation-secret" });
    const coverage = structuredClone(archived.at(-1)!.coverage) as ReviewCoverage;
    await assert.rejects(() => executeCoveredReview(input, coverage, "fixture", async () => { throw unknown; }), error => error === unknown);
    assert.deepEqual(coverage.assessment?.failure, { stage: "generation", code: "unclassified", keyOwner: "unknown", ownership: "unknown", retryability: "unknown" });
    assert.doesNotMatch(JSON.stringify(coverage.assessment), /synthetic-generation-secret|req_syntheticgenerationsecret/);
    const incomplete = structuredClone(coverage); incomplete.complete = false;
    assert.equal(reviewCheckResult(incomplete, false, 0).title, "Review incomplete — input coverage missing");
    const cancelled = new AbortController(); cancelled.abort();
    const cancelledCoverage = structuredClone(coverage);
    await assert.rejects(() => executeCoveredReview({ ...input, executionWindow: { jobId: "fixture", deadlineEpochMs: Date.now(), signal: cancelled.signal, remainingMs: () => 0 } }, cancelledCoverage, "fixture", async () => { throw unknown; }), error => error === unknown);
    assert.equal(cancelledCoverage.assessment?.failure, undefined, "cancelled work is not labeled a provider incident");
    const abort = new AiProviderFailure(Object.assign(new Error("synthetic-generation-secret"), { name: "AbortError" }), "openai", "gpt-fixture", "platform");
    const abortCoverage = structuredClone(coverage);
    await assert.rejects(() => executeCoveredReview(input, abortCoverage, "fixture", async () => { throw abort; }), error => error === abort);
    assert.equal(abortCoverage.assessment?.failure, undefined, "an abort without further evidence remains unclassified");
    const untyped = structuredClone(coverage);
    await assert.rejects(() => executeCoveredReview(input, untyped, "fixture", async () => { throw new Error("synthetic-generation-secret"); }));
    assert.equal(untyped.assessment?.failure, undefined, "unknown errors are not labeled a provider failure");
  } finally { console.error = originalError; }
  console.log("PASS generation failures retain safe attempt evidence");
  process.exit(0);
}
if (publicationErrorPrivacy || generationSetupErrorPrivacy) {
  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    await processReview("pr");
    assert.ok(checkConclusions.includes("failure"), "publication failure is reported as a failed check");
    assert.ok((reviewUpdates as { data: { status?: string } }[]).some(update => update.data.status === "failed"), "publication failure is persisted");
    assert.ok(events.some(event => event.status === "failed"), "publication failure remains visible to the user");
    const expected = publicationErrorPrivacy ? "Review failed while publishing the review" : "Review failed during generation";
    assert.ok(inspect({ checkOutputs, reviewUpdates, events }).includes(expected), "the user sees the correct failure stage");
    assert.ok(inspect(errors).includes("503"), "safe status remains available in diagnostics");
    assert.doesNotMatch(inspect({ errors, summaries, checkOutputs, reviewUpdates, events, sentryEvents }, { depth: 20 }), /synthetic-best-effort-private|req_syntheticprivate123/);
  } finally { console.error = originalError; }
  process.exit(0);
}
if (bestEffortPrivacy) {
  const errors: unknown[][] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = console.warn = (...args: unknown[]) => { errors.push(args); };
  try {
    responseOverride = report + "\n```mermaid\nflowchart TD\nA-->B\n```";
    for (const [mode, site, expected] of [
      ["reaction", "feedback-embedding", "Failed to sync reaction"],
      ["reply", "feedback-storage", "Failed to record text feedback"],
      ["per-finding", "feedback-embedding", "Failed to record per-finding feedback"],
      ["bulk", "feedback-storage", "Failed to embed feedback pattern"],
      ["", "suppression-embedding", "Semantic feedback matching failed"],
      ["", "review-embedding", "Failed to store review"],
      ["", "review-storage", "Failed to store review"],
      ["", "diagram-embedding", "Failed to store diagrams"],
      ["", "diagram-storage", "Failed to store diagrams"],
      ["", "pubby", "Pubby trigger failed"],
      ["", "check-run", "Failed to create check run"],
      ["", "prior-reviews", "Failed to fetch prior review bodies"],
      ["", "running-status", "Failed to set provider running status"],
      ["", "pr-body-fetch", "Could not fetch PR body"],
      ["", "branch-head", "Failed to fetch branch head"],
      ["", "tree-cache", "Failed to persist tree cache"],
      ["", "inline-review", "Failed to submit inline review"],
      ["", "review-fallback", "Failed to submit PR review"],
      ["", "match-ids", "Failed to match GitHub comment IDs"],
      ["", "project-inline", "Failed to post inline comment"],
      ["", "final-status", "Failed to set provider commit status"],
      ["", "validation", "Two-pass validation failed"],
      ["", "followup", "Follow-up findings call failed"],
      ["", "", ""],
    ]) {
      feedbackMode = mode; failureSite = site;
      privacyGenerationCalls = 0;
      responseOverride = report.replace("| 🟠 High | 1 |", site === "followup" ? "| 🟠 High | 2 |" : "| 🟠 High | 1 |") + "\n```mermaid\nflowchart TD\nA-->B\n```";
      repo.provider = ["branch-head", "tree-cache", "running-status", "project-inline", "final-status"].includes(site) ? "gitlab" : "github";
      errors.length = 0; events.length = 0; summaries.length = 0; checkOutputs.length = 0; feedbackUpdates.length = 0; reviewAttempts.length = 0;
      await processReview("pr");
      if (site === "inline-review") {
        assert.deepEqual(reviewAttempts, [1, 0], "hosted 403 falls back once to a summary-only review");
        assert.equal(published.at(-1)?.comments.length, 0);
        assert.ok(inspect(errors).includes("403"));
      }
      if (expected) assert.ok(inspect(errors).includes(expected), `reaches ${site} via ${mode}`);
      else assert.equal(errors.length, 0);
      if (mode) assert.ok(feedbackUpdates.length, "feedback is recorded before best-effort embedding");
      assert.equal((archived.at(-1)?.coverage as ReviewCoverage).assessment?.state, site === "followup" ? "incomplete" : "completed");
      if (site === "followup") {
        assert.equal(privacyGenerationCalls, 2, "the synthetic failure occurs during the follow-up");
        assert.doesNotMatch(summaries.at(-1) ?? "", /\|[^\n]*[1-5]\/5/, "incomplete recovery must not publish a score");
      }
      if (site !== "pubby") assert.ok(events.some(event => event.status === "completed"));
      assert.ok(checkOutputs.length || (site === "check-run" && published.length), "completed review is published");
      assert.doesNotMatch(inspect({ errors, events, summaries, checkOutputs, reviewUpdates, archived, sentryEvents }, { depth: 20 }), /synthetic-best-effort-private|req_syntheticprivate123/);
      if (expected && site !== "inline-review") assert.ok(inspect(errors).includes("503"));
    }
    for (const mode of ["classifier-reply", "classifier-bulk"]) {
      feedbackMode = mode; failureSite = "classifier"; repo.provider = "github";
      errors.length = 0; feedbackUpdates.length = 0; usageOperations.length = 0; events.length = 0;
      await processReview("pr");
      assert.ok(inspect(errors).includes("LLM reply classification failed"));
      assert.doesNotMatch(inspect(errors, { depth: 20 }), /synthetic-secret|req_syntheticprivate123/);
      assert.equal(feedbackUpdates.length, 0, "unclear classification leaves feedback unchanged");
      assert.equal(usageOperations.filter(operation => operation === "feedback-classification").length, 1);
      assert.ok(events.some(event => event.status === "completed"), "review continues after classification failure");
    }
  } finally { console.error = originalError; console.warn = originalWarn; }
  process.exit(0);
}
if (embeddingErrorPrivacy) {
  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    for (const provider of embeddingCancelPrivacy ? ["github"] : ["github", "gitlab", "bitbucket"]) {
      repo.provider = provider;
      events.length = 0; summaries.length = 0; checkOutputs.length = 0; reviewUpdates.length = 0; errors.length = 0; sentryEvents.length = 0;
      const beforeEmbedding = embeddingCalls;
      await processReview("pr", embeddingCancelPrivacy ? { jobId: "synthetic", deadlineEpochMs: Date.now() + 900000, signal: adaptiveAbort.signal, remainingMs: () => 900000 } : undefined);
      assert.equal(embeddingCalls, beforeEmbedding + 1, `${provider} reaches the embedding failure`);
      assert.ok(summaries.length || checkOutputs.length, "failure remains visible to the provider");
      assert.doesNotMatch(inspect({ summaries, checkOutputs, reviewUpdates, events, errors, sentryEvents }, { depth: 20 }), /synthetic-embedding-private/);
      assert.ok(events.some(event => event.error === "Review failed while preparing search context"));
      assert.ok(reviewUpdates.some(update => (update as { data: { status?: string; errorMessage?: string } }).data.status === "failed" && (update as { data: { errorMessage?: string } }).data.errorMessage === "Review failed while preparing search context"));
      if (embeddingCancelPrivacy) assert.equal(sentryEvents.length, 0, "cancelled work is not reported as a failure");
      else {
        assert.ok(inspect(errors).includes("503"), "safe provider status remains in diagnostics");
        assert.equal(sentryEvents.at(-1)?.tags?.failure_stage, "preparation");
        assert.equal(sentryEvents.at(-1)?.tags?.failure_code, "http_503");
      }
    }
  } finally { console.error = originalError; }
  process.exit(0);
}
if (providerErrorPrivacy) {
  const logs: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logs.push(inspect(args)); };
  try {
    await processReview("pr");
    assert.ok(reviewUpdates.some((update) => (update as { data: { status?: string } }).data.status === "failed"));
    assert.equal((archived.at(-1)?.coverage as ReviewCoverage).assessment?.state, "incomplete");
    assert.ok(checkOutputs.length, "failure must still update the GitHub check");
    assert.doesNotMatch(JSON.stringify({ logs, summaries, checkOutputs, reviewUpdates, events, archived, sentryEvents }), /synthetic-credential-and-prompt/);
  } finally { console.error = originalError; }
  console.log("PASS provider failure remains private in review outputs");
  process.exit(0);
}
if (indexingPrivacy) {
  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(arg => arg instanceof Error ? String(arg) : arg)); };
  try {
    for (const provider of ["github", "gitlab", "bitbucket"]) {
      repo.provider = provider;
      repo.indexStatus = "pending";
      events.length = 0; summaries.length = 0; checkOutputs.length = 0; reviewUpdates.length = 0;
      await processReview("pr", undefined, 2);
      assert.equal(repo.indexStatus, "failed");
      assert.ok(summaries.some(body => body.includes("Review failed while preparing the repository")));
      assert.ok(reviewUpdates.some((query) => { const data = (query as { data: { status?: string; errorMessage?: string } }).data; return data.status === "failed" && data.errorMessage === "Review failed while preparing the repository"; }));
      assert.ok(events.some((event) => event.type === "review-failed" && event.error === "Review failed while preparing the repository"));
      assert.ok(events.some((event) => event.status === "failed" && event.error === "Review failed while preparing the repository"));
      if (provider !== "bitbucket") assert.ok(JSON.stringify(checkOutputs).includes("Review failed while preparing the repository"));
      assert.doesNotMatch(JSON.stringify({ summaries, checkOutputs, reviewUpdates, events, errors, sentryEvents }), /synthetic-secret|private\/path/);
      assert.equal(sentryEvents.at(-1)?.tags?.failure_stage, "indexing");
      assert.equal(sentryEvents.at(-1)?.contexts?.background_failure?.retryCount, 2);
    }
    repo.provider = "github";
    repo.indexStatus = "pending";
    peerAlreadyIndexed = true;
    events.length = 0; summaries.length = 0; checkOutputs.length = 0; reviewUpdates.length = 0;
    const beforePeerIndexing = indexingCalls;
    await processReview("pr");
    assert.equal(repo.indexStatus, "indexed");
    assert.equal(indexingCalls, beforePeerIndexing);
    assert.ok(summaries.some(body => body.includes("Review failed while preparing the repository")));
    assert.ok(reviewUpdates.some((query) => { const data = (query as { data: { status?: string; errorMessage?: string } }).data; return data.status === "failed" && data.errorMessage === "Review failed while preparing the repository"; }));
    assert.ok(events.some(event => event.type === "review-failed" && event.error === "Review failed while preparing the repository"));
    assert.ok(events.some(event => event.status === "failed" && event.error === "Review failed while preparing the repository"));
    assert.ok(JSON.stringify(checkOutputs).includes("Review failed while preparing the repository"));
    assert.doesNotMatch(JSON.stringify({ summaries, checkOutputs, reviewUpdates, events, errors, sentryEvents }), /synthetic-secret|private\/path/);
    peerAlreadyIndexed = false;
    repo.indexStatus = "indexed";
    preparationFetchFailure = "review_input";
    reviewUpdates.length = 0;
    await processReview("pr");
    assert.ok(reviewUpdates.some((query) => { const data = (query as { data: { status?: string; errorMessage?: string } }).data; return data.status === "failed" && data.errorMessage === "Review failed during preparation"; }));
    assert.doesNotMatch(inspect({ summaries, checkOutputs, reviewUpdates, events, errors, sentryEvents }, { depth: 20 }), /synthetic private input/);
  } finally { console.error = originalError; }
  console.log("PASS indexing failures are private across review outputs");
  process.exit(0);
}
if (refusalFlow) {
  const originalError = console.error;
  console.error = () => {};
  try {
    await processReview("pr");
    assert.equal(refusalCalls, 1);
    assert.equal(usageCount, 0, "refused generation must not log usage as a completed response");
    assert.equal(sentryEvents.length, 1);
    assert.equal(sentryEvents[0].tags?.failure_code, "PROVIDER_REFUSAL");
    assert.equal(sentryEvents[0].tags?.failure_stage, "generation");
    assert.equal((archived.at(-1)?.coverage as ReviewCoverage).assessment?.state, "incomplete");
    assert.ok(reviewUpdates.some((update) => (update as { data: { status?: string } }).data.status === "failed"));
    assert.equal(published.length, 0, "failed generation must not publish a scored review");
    assert.ok(!/\|[^\n]*[1-5]\/5/.test(summaries.at(-1) ?? ""), "failed summary must not claim a score");
  } finally { console.error = originalError; }
  console.log("PASS refusal remains an incomplete failed review");
  process.exit(0);
}
if (preparationDiagnostic) {
  const originalError = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    for (const operation of ["review_input", "repository_tree"] as const) {
      preparationFetchFailure = operation;
      pr.status = "pending";
      summaries.length = 0; checkOutputs.length = 0; reviewUpdates.length = 0; events.length = 0; errors.length = 0;
      const before = sentryEvents.length;
      await processReview("pr");
      assert.equal(sentryEvents.length, before + 1);
      assert.equal(sentryEvents.at(-1)?.tags?.failure_stage, "preparation");
      assert.equal(sentryEvents.at(-1)?.tags?.preparation_operation, operation);
      assert.equal(sentryEvents.at(-1)?.tags?.failure_code, "http_503");
      assert.ok(reviewUpdates.some((query) => { const data = (query as { data: { status?: string; errorMessage?: string } }).data; return data.status === "failed" && data.errorMessage === "Review failed during preparation"; }));
      assert.ok(checkOutputs.length || summaries.length, "failure remains visible to the provider");
      assert.ok(events.some(event => event.status === "failed" && event.error === "Review failed during preparation"));
      assert.doesNotMatch(inspect({ summaries, checkOutputs, reviewUpdates, events, errors, sentryEvents }, { depth: 20 }), /synthetic private|req_syntheticprivate123/);
    }
    preparationFetchFailure = null;
    repo.provider = "gitlab";
    failureSite = "initial-comment";
    summaries.length = 0; checkOutputs.length = 0; reviewUpdates.length = 0; events.length = 0; errors.length = 0; sentryEvents.length = 0;
    await processReview("pr");
    assert.equal(sentryEvents.at(-1)?.tags?.failure_stage, "review");
    assert.equal(sentryEvents.at(-1)?.tags?.failure_code, "http_503");
    assert.ok(reviewUpdates.some((query) => { const data = (query as { data: { status?: string; errorMessage?: string } }).data; return data.status === "failed" && data.errorMessage === "Review failed while starting the review"; }));
    assert.ok(events.some(event => event.status === "failed" && event.error === "Review failed while starting the review"));
    assert.ok(checkOutputs.some(output => typeof output === "string" && output.includes("Review failed while starting the review")));
    assert.doesNotMatch(inspect({ summaries, checkOutputs, reviewUpdates, events, errors, sentryEvents }, { depth: 20 }), /synthetic-best-effort-private|req_syntheticprivate123/);
    failureSite = "";
    repo.provider = "github";
    pr.status = "pending";
    const before = sentryEvents.length;
    await processReview("pr");
    assert.equal(sentryEvents.length, before, "successful preparation emits no incident");
    preparationFetchFailure = "large_pr";
    pr.status = "pending";
    await processReview("pr");
    assert.ok(queuedJobs.includes("process-large-review"), "oversized GitHub review is handed off");
    assert.equal(sentryEvents.length, before, "handled large review emits no incident");
  } finally { console.error = originalError; }
  console.log("PASS preparation fetch diagnostics");
  process.exit(0);
}
if (crashRecovery) {
  // A complete review: the archive, one summary comment, one inline review and a finished check.
  await processReview("pr");
  const attempt = archived[0];
  assert.equal((pr as { reviewAttemptId?: string }).reviewAttemptId, attempt.id, "the claim stores the attempt ID that is archived later");
  assert.equal(pr.status, "completed");
  assert.equal(leaseHeldWhilePublishing, true, "an unfinished publication holds a delivery lease, which a drain counts");
  assert.ok(deliveries.get(attempt.id)?.completedAt);
  assert.equal(deliveries.get(attempt.id)?.leaseUntil, null);
  assert.equal(deliveries.get(attempt.id)?.mainCommentId, 123);
  assert.deepEqual([published.length, checkConclusions.length], [1, 1]);
  const finalSummary = summaries.at(-1)!;
  const finalCheck = checkConclusions[0];
  const dispatched = usageCount;

  deliveries.delete(attempt.id);
  summaries.length = 0; checkConclusions.length = 0;
  await processReview("pr");
  assert.equal(summaries.length, 1);
  assert.deepEqual(checkConclusions, [finalCheck]);
  assert.ok(deliveries.get(attempt.id)?.completedAt);

  // The worker stopped after archiving the result and before publishing it. A redelivered job finishes
  // the publication from the archive: same comment, completed check, completed delivery, no second review.
  const stopped = () => { deliveries.set(attempt.id, { attemptId: attempt.id, mainCommentId: null, completedAt: null, leaseToken: "stopped-worker", leaseUntil: new Date(Date.now() - 1) }); summaries.length = 0; checkConclusions.length = 0; pr.firstReviewCompletedAt = null; };
  stopped();
  await processReview("pr");
  assert.equal(summaries.length, 1);
  assert.ok(summaries[0].startsWith(`Review attempt: ${attempt.id}. Head: ${pr.headSha}.`));
  assert.ok(summaries[0].includes("### Score") && !summaries[0].includes("OCTOPUS_FINDINGS_START"), "the comment is derived from the archived report");
  assert.equal(summaries[0].includes("### Summary"), finalSummary.includes("### Summary"));
  assert.deepEqual(checkConclusions, [finalCheck]);
  assert.ok(deliveries.get(attempt.id)?.completedAt);
  assert.ok(pr.firstReviewCompletedAt);
  assert.deepEqual([archived.length, published.length, usageCount], [1, 1, dispatched], "nothing is generated, archived or reviewed again");
  // The check is finished with the decision kept in the archive, not recomputed from saved findings.
  const decision = (attempt.coverage as { nativeCheckDecision?: { fail: boolean; findings: number } }).nativeCheckDecision;
  assert.ok(decision, "the attempt keeps its check decision");
  (attempt.coverage as { nativeCheckDecision: object }).nativeCheckDecision = { ...decision, fail: !decision.fail };
  stopped();
  await processReview("pr");
  assert.notDeepEqual(checkConclusions, [finalCheck]);
  (attempt.coverage as { nativeCheckDecision: object }).nativeCheckDecision = decision;
  stopped();
  await processReview("pr");
  assert.deepEqual(checkConclusions, [finalCheck]);
  // A delivered review is left alone.
  await processReview("pr");
  assert.deepEqual([summaries.length, checkConclusions.length], [1, 1]);
  // While the publisher's lease is live it may still be running: publish nothing and look again later.
  stopped();
  deliveries.get(attempt.id)!.leaseUntil = new Date(Date.now() + 60_000);
  await processReview("pr");
  assert.deepEqual([summaries.length, checkConclusions.length, delayedJobs.length], [0, 0, 1]);
  assert.deepEqual(delayedJobs[0].slice(0, 2), ["process-review", { pullRequestId: "pr" }]);
  // A large-PR result (no assessment) is delivered by its own job, never from here.
  stopped();
  const assessed = attempt.coverage;
  attempt.coverage = { ...(assessed as object), assessment: undefined };
  await processReview("pr");
  assert.equal(summaries.length, 0);
  attempt.coverage = assessed;
  deliveries.get(attempt.id)!.completedAt = new Date();

  // The worker stopped after posting the inline review and before archiving. The redelivered job reviews
  // again and posts the review that its own check and report describe, so the two always agree.
  priorBotReviews = [{ id: 456, user: "fixture[bot]", body: published[0].body }];
  pr.status = "pending";
  await processReview("pr");
  assert.deepEqual([archived.length, published.length], [2, 2]);
  assert.equal(pr.status, "completed");

  // A claim that replaces a review which stopped without finishing records that attempt under its own ID.
  assert.deepEqual(interruptedAttempts, []);
  const stoppedAttempt = (pr as { reviewAttemptId?: string }).reviewAttemptId;
  Object.assign(pr, { status: "reviewing", updatedAt: new Date(Date.now() - 600_000) });
  await processReview("pr");
  assert.deepEqual(interruptedAttempts, [stoppedAttempt]);
  assert.notEqual((pr as { reviewAttemptId?: string }).reviewAttemptId, stoppedAttempt);
  assert.equal(archived.at(-1)?.id, (pr as { reviewAttemptId?: string }).reviewAttemptId);
  console.log("PASS interrupted publication resumes from the archive");
  process.exit(0);
}
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
  assert.equal(indexingCalls, 1);
  assert.deepEqual(events.filter(event => event.eventName === "index-log").map(event => event.message), ["Processed 5 files, skipped 0", "Indexing message withheld for privacy.", "Indexing complete: 1 files, 1 vectors"]);
  assert.equal(indexTransactions, 1);
  assert.ok(repo.firstIndexedAt);
  const firstIndex = repo.firstIndexedAt;
  for (const mode of ["fail", "replace", "replace-success"] as const) {
    indexPreparation = mode;
    repo.indexStatus = "pending";
    events.length = 0;
    const errors = console.error;
    console.error = () => {};
    const beforeIncidents = sentryEvents.length;
    try { await processReview("pr", undefined, 2); } finally { console.error = errors; }
    assert.equal(sentryEvents.length - beforeIncidents, mode === "fail" ? 1 : 0);
    if (mode === "fail") {
      assert.equal(sentryEvents.at(-1)?.contexts?.background_failure?.attemptId, repo.indexAttemptId);
      assert.equal(sentryEvents.at(-1)?.contexts?.background_failure?.retryCount, 2);
      assert.equal(sentryEvents.at(-1)?.tags?.failure_stage, "indexing");
    }
    assert.equal(repo.indexStatus, mode === "fail" ? "failed" : "indexing");
    assert.equal(indexingCalls, mode === "replace-success" ? 2 : 1, "Only successful setup reaches the indexer");
    assert.deepEqual(repo.firstIndexedAt, firstIndex);
    assert.equal(repo.autoReview, false);
    assert.equal(events.some(event => event.eventName === "index-status" && event.status === "failed"), mode === "fail");
    if (mode !== "fail") assert.equal(repo.indexAttemptId, "replacement-attempt");
  }
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
    assert.equal(data.errorMessage, "Review failed while starting the review");
    return true;
  }), "Direct comment failure is persisted for the same review attempt");
  assert.ok(events.some(event => event.type === "review-failed"));
  console.log("PASS handled direct Forgejo comment failure without connector uncertainty");
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
const beforeSentryFailure = sentryEvents.length;
const errorLog = console.error;
console.error = () => {};
try {
  await processReview("pr", undefined, 1);
  assert.equal(sentryEvents.at(-1)?.contexts?.background_failure?.retryCount, 1);
  assert.equal((archived.at(-1)!.coverage as ReviewCoverage).complete, true);
  assert.equal((archived.at(-1)!.coverage as ReviewCoverage).assessment?.state, "incomplete");
  assert.equal((archived.at(-1)!.coverage as ReviewCoverage).assessment?.reason, "Provider request failed or was interrupted");
  assert.equal(sentryEvents.length, beforeSentryFailure + 1, "caught provider failure must reach Sentry exactly once");
  assert.equal(sentryEvents.at(-1)?.tags?.failure_stage, "generation");
  assert.equal(sentryEvents.at(-1)?.contexts?.background_failure?.pullRequestId, "pr");
  const cancelled = new AbortController(); cancelled.abort();
  const before = sentryEvents.length;
  await processReview("pr", { jobId: "cancelled-ordinary", deadlineEpochMs: Date.now() + 900000,
    signal: cancelled.signal, remainingMs: () => 900000 });
  assert.equal(sentryEvents.length, before);
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
for (const reason of ["metadata-unavailable", "count-unavailable", "pricing-unavailable", "final-check-failed", "context-limit", "billing-blocked", "stale-review"] as const) {
  for (const abort of [null, "cancel", "timeout", "expired"] as const) {
    capacityReason = reason; capacityAbort = abort; adaptiveStage = "admission";
    adaptiveAbort = new AbortController(); adaptiveRemaining = 900000;
    const before = sentryEvents.length;
    const errors = console.error; console.error = () => {};
    try { await processReview("pr", { jobId: "admission", deadlineEpochMs: Date.now() + 900000,
      signal: adaptiveAbort.signal, remainingMs: () => adaptiveRemaining }); } finally { console.error = errors; }
    const actionable = reason.endsWith("unavailable") || reason === "final-check-failed";
    assert.equal(sentryEvents.length - before, actionable && abort !== "cancel" ? 1 : 0, `${reason}/${abort}`);
    if (actionable && abort !== "cancel") assert.equal(sentryEvents.at(-1)?.tags?.failure_code, `capacity_${reason}`);
  }
}
capacityAbort = null;
for (const stage of ["generation-cancel", "generation-timeout", "generation-expired", "before-validator", "during-validator", "expired-validator", "after-save"] as const) {
  adaptiveStage = stage; adaptiveAbort = new AbortController(); adaptiveRemaining = 900000;
  const before = archived.length, validations = validatorCalls, checks = checkConclusions.length;
  const beforeIncidents = sentryEvents.length;
  const errors = console.error; console.error = () => {};
  try {
    await processReview("pr", { jobId: "synthetic-adaptive", deadlineEpochMs: Date.now() + 900000,
      signal: adaptiveAbort.signal, remainingMs: () => adaptiveRemaining });
  } finally { console.error = errors; }
  assert.equal(sentryEvents.length - beforeIncidents, ["expired-validator", "generation-timeout", "generation-expired"].includes(stage) ? 1 : 0, stage);
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
  if (stage === "before-validator" || stage.startsWith("generation-")) assert.equal(validatorCalls, validations);
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
  const beforeIncidents = sentryEvents.length;
  const errors = console.error; console.error = () => {};
  try {
    await processReview("pr", { jobId: "synthetic-adaptive", deadlineEpochMs: Date.now() + 900000,
      signal: adaptiveAbort.signal, remainingMs: () => adaptiveRemaining });
  } finally { console.error = errors; }
  if (!stage.endsWith("control")) assert.equal(sentryEvents.length - beforeIncidents, stage === "summary-timeout" ? 1 : 0, stage);
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
        assert.ok(forgejoPublications.some(body => body.includes("Review failed during preparation")));
        assert.ok(!forgejoPublications.some(body => body.includes("Repository analysis failed")));
        assert.equal(forgejoPublications.at(-1), "failed");
      } else {
        assert.ok(forgejoPublications.some(body => body.includes("Starting PR review")));
      }
    }
  }
}
console.log("PASS direct Forgejo progress and best-effort status, connector publication deferral");
