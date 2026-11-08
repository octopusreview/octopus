import { mock } from "bun:test";
import assert from "node:assert/strict";

const secret = "synthetic-secret-request-id";
const failure = Object.assign(new Error(secret), { status: 503, request_id: secret });
const id = "12345678-1234-1234-1234-123456789abc";
let scenario = "fatal";
let job: Record<string, any>;
const reset = (postMode = "action_client") => { job = { id, repositoryId: "repo", organizationId: "org", repoFullName: "owner/repo", status: "pending", expiresAt: new Date(Date.now() + 60000), githubToken: "ciphertext", postMode, prNumber: 1, diff: "diff", attempts: 0 }; };
reset();
mock.module("server-only", () => ({}));
mock.module("@octopus/db", () => ({ prisma: {
  communityReviewJob: {
    findUnique: async () => ({ ...job }), findFirst: async () => ({ id }),
    updateMany: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(job, data); return { count: 1 }; },
  },
  repository: { findUnique: async () => ({ id: "repo", organizationId: "org", provider: "github", fullName: "owner/repo", externalId: "external", indexStatus: "indexed" }) },
  pullRequest: { count: async () => { if (scenario === "fatal") throw failure; return 0; } },
} }));
mock.module("@/lib/repository-index-completion", () => ({ runRepositoryIndex: async () => { throw new Error("unexpected indexing"); } }));
mock.module("@/lib/review-core", () => ({ generateLocalReview: async () => ({ findings: [], summary: "done", model: "fixture", usage: { inputTokens: 1, outputTokens: 1 } }) }));
for (const [path, names] of Object.entries({ indexer: ["indexRepository"], summarizer: ["summarizeRepository"], analyzer: ["analyzeRepository"] })) {
  mock.module(`@/lib/${path}`, () => Object.fromEntries(names.map(name => [name, async () => { throw new Error("unexpected indexing"); }])));
}
mock.module("@/lib/github", () => ({ getRepositoryTree: async () => { if (scenario === "nonfatal") throw failure; return []; }, getPullRequestDiff: async () => "diff" }));
mock.module("@/lib/generated-files", () => ({ buildGeneratedMatcher: () => ({}), splitDiffByIgnore: (diff: string) => ({ kept: diff, skipped: [] }) }));
mock.module("@/lib/diff-truncate", () => ({ truncateDiff: (diff: string) => diff }));
mock.module("@/lib/events/bus", () => ({ eventBus: { emit: () => {} } }));
class CommunityRepositoryChangedError extends Error {}
mock.module("@/lib/community-pr-persist", () => ({ CommunityRepositoryChangedError, persistCommunityReviewToPR: async () => { if (scenario === "nonfatal") throw failure; } }));
mock.module("@/lib/community-review-completion", () => ({
  clearTerminalCommunityJobToken: async () => { job.githubToken = null; },
  completeCommunityReviewJob: async (_id: string, _identity: unknown, data: object) => { Object.assign(job, data); },
}));
mock.module("@/lib/crypto", () => ({ decryptString: () => { if (scenario === "decrypt") throw failure; return "token"; } }));
mock.module("@/lib/oss-bot", () => ({ getBotToken: () => "token" }));
mock.module("@/lib/oss-review-post", () => ({ postOssReview: async () => { if (scenario === "nonfatal") throw failure; return { posted: 0, skipped: 0 }; } }));
const { processCommunityReview } = await import("@/lib/community-review");
const { GET } = await import("../../../app/api/github-action/review/[jobId]/route");
const logs: unknown[][] = [];
const original = { log: console.log, error: console.error, warn: console.warn };
console.log = console.error = console.warn = (...args: unknown[]) => { logs.push(args); };
const poll = () => GET(new Request(`http://localhost/?repo=owner/repo`) as never, { params: Promise.resolve({ jobId: id }) });
try {
  await assert.rejects(() => processCommunityReview(id), error => error === failure);
  assert.equal(job.status, "failed");
  assert.equal(job.errorMessage, "Review failed");
  assert.equal(job.githubToken, null);
  assert.deepEqual(await (await poll()).json(), { status: "failed", jobId: id, error: "Review failed" });
  job.errorMessage = secret;
  assert.deepEqual(await (await poll()).json(), { status: "failed", jobId: id, error: "Review failed" });
  scenario = "decrypt"; reset();
  await assert.rejects(() => processCommunityReview(id), /githubToken decrypt failed/);
  assert.equal(job.status, "failed"); assert.equal(job.githubToken, null);
  scenario = "nonfatal"; reset("bot_account");
  await processCommunityReview(id);
  assert.equal(job.status, "completed"); assert.equal(job.githubToken, null);
  assert.equal((await (await poll()).json()).status, "completed");
  assert.equal(logs.filter(row => String(row[0]).includes("non-fatal")).length, 3);
  assert.equal(JSON.stringify(logs).includes(secret), false);
} finally { Object.assign(console, original); }
