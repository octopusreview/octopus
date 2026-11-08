import { mock } from "bun:test";
import assert from "node:assert/strict";

const scenario = process.argv[2];
assert.ok(scenario === "worker" || scenario === "action");
const repo = { id: "synthetic-repo", organizationId: "synthetic-org", provider: "github", externalId: "1", fullName: "synthetic/repo", defaultBranch: "main", indexStatus: "indexed", indexedAt: null };
const job = { id: "synthetic-job", status: "indexing", repositoryId: repo.id, organizationId: repo.organizationId, expiresAt: new Date(Date.now() + 60_000),
  startedAt: null, postMode: "action_client", githubToken: "synthetic", repoFullName: repo.fullName, prNumber: 1, diff: "synthetic", prTitle: null, prAuthor: null, headSha: null };
let generated = 0;
let events = 0;
class CommunityRepositoryChangedError extends Error {}
mock.module("server-only", () => ({}));
mock.module("@octopus/db", () => ({ prisma: {
  communityReviewJob: { findUnique: async () => job, update: async ({ data }: { data: object }) => Object.assign(job, data) },
  organization: { upsert: async () => ({ id: repo.organizationId, communityDailyReviewLimit: 5 }) },
  repository: { findUnique: async () => repo, upsert: async () => repo },
  pullRequest: { count: async () => 0 }, aiUsage: { count: async () => 0 },
} }));
mock.module("@/lib/community-pr-persist", () => ({ CommunityRepositoryChangedError, persistCommunityReviewToPR: async () => { throw new CommunityRepositoryChangedError(); } }));
mock.module("@/lib/repository-index-completion", () => ({ runRepositoryIndex: () => { throw new Error("unexpected index"); } }));
mock.module("@/lib/review-core", () => ({ generateLocalReview: async () => { generated++; return { summary: "synthetic", findings: [], model: "synthetic" }; } }));
mock.module("@/lib/indexer", () => ({ indexRepository: () => { throw new Error("unexpected index"); } }));
mock.module("@/lib/indexed-repository-analysis", () => ({ analyzeIndexedRepository: () => { throw new Error("unexpected analysis"); } }));
mock.module("@/lib/summarizer", () => ({ summarizeRepository: () => { throw new Error("unexpected summary"); } }));
mock.module("@/lib/analyzer", () => ({ analyzeRepository: () => { throw new Error("unexpected analysis"); } }));
mock.module("@/lib/github", () => ({ getRepositoryTree: async () => [], getPullRequestDiff: async () => "" }));
mock.module("@/lib/generated-files", () => ({ buildGeneratedMatcher: () => ({}), splitDiffByIgnore: (text: string) => ({ kept: text, skipped: [] }) }));
mock.module("@/lib/diff-truncate", () => ({ truncateDiff: (text: string) => text }));
mock.module("@/lib/events/bus", () => ({ eventBus: { emit: () => { events++; } } }));
mock.module("@/lib/crypto", () => ({ decryptString: () => "synthetic", encryptString: () => "synthetic" }));
mock.module("@/lib/oss-bot", () => ({ getBotToken: () => "synthetic" }));
mock.module("@/lib/oss-review-post", () => ({ postOssReview: () => { throw new Error("unexpected post"); } }));
mock.module("@/lib/api-auth", () => ({ authenticateApiToken: async () => null }));
mock.module("@/lib/cost", () => ({ isOrgOverSpendLimit: async () => false }));
mock.module("@/lib/queue", () => ({ enqueue: () => { throw new Error("unexpected queue"); } }));
mock.module("@/lib/external-review-activity", () => ({ withExternalReviewActivity: async (_: unknown, fn: () => Promise<Response>) => fn() }));
globalThis.fetch = (async () => Response.json({ id: 1, default_branch: "main", private: false, full_name: repo.fullName })) as typeof fetch;
if (scenario === "worker") {
  const { processCommunityReview } = await import("@/lib/community-review");
  await assert.rejects(() => processCommunityReview(job.id), CommunityRepositoryChangedError);
  assert.equal(job.status, "failed");
  assert.equal(job.githubToken, null);
} else {
  const { POST } = await import("@/app/api/github-action/review/route");
  const response = await POST(new Request("https://example.invalid/api/github-action/review", { method: "POST", body: JSON.stringify({
    owner: "synthetic", repo: "repo", prNumber: 1, diff: "synthetic", githubToken: "synthetic",
  }) }) as never);
  assert.equal(response.status, 500);
}
assert.equal(generated, 1);
assert.equal(events, 0);
