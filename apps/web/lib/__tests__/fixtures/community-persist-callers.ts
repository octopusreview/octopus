import { mock } from "bun:test";
import assert from "node:assert/strict";

const scenario = process.argv[2];
assert.ok(["worker", "worker-no-pr", "worker-job-transferred", "worker-cancelled", "worker-cancelled-after-generation", "action"].includes(scenario));
const repo = { id: "synthetic-repo", organizationId: "synthetic-org", provider: "github", externalId: "1", fullName: "synthetic/repo", defaultBranch: "main", indexStatus: "indexed", indexedAt: null };
const job = { id: "synthetic-job", status: scenario === "worker-cancelled" ? "cancelled" : "indexing", repositoryId: repo.id, organizationId: repo.organizationId, expiresAt: new Date(Date.now() + 60_000),
  startedAt: null, postMode: "action_client", githubToken: "synthetic", repoFullName: repo.fullName, prNumber: ["worker-no-pr", "worker-cancelled-after-generation"].includes(scenario) ? null : 1, diff: "synthetic", prTitle: null, prAuthor: null, headSha: null };
let generated = 0;
let events = 0;
class CommunityRepositoryChangedError extends Error {}
const jobUpdateMany = async ({ where, data }: { where: { organizationId: string; repositoryId: string; status?: { in?: string[]; notIn?: string[] }; githubToken?: string }; data: object }) => {
  if (where.organizationId !== job.organizationId || where.repositoryId !== job.repositoryId ||
      (where.status?.in && !where.status.in.includes(job.status)) || where.status?.notIn?.includes(job.status) ||
      (where.githubToken !== undefined && where.githubToken !== job.githubToken)) return { count: 0 };
  Object.assign(job, data);
  return { count: 1 };
};
mock.module("server-only", () => ({}));
mock.module("@octopus/db", () => ({ prisma: {
  communityReviewJob: { findUnique: async () => ({ ...job }), update: async ({ data }: { data: object }) => Object.assign(job, data), updateMany: jobUpdateMany },
  organization: { upsert: async () => ({ id: repo.organizationId, communityDailyReviewLimit: 5 }) },
  repository: { findUnique: async () => repo, upsert: async () => repo },
  pullRequest: { count: async () => 0 }, aiUsage: { count: async () => 0 },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ $queryRaw: async () => [scenario === "worker-cancelled-after-generation" ? repo : { ...repo, organizationId: "other-org" }], communityReviewJob: { updateMany: jobUpdateMany } }),
} }));
mock.module("@/lib/community-pr-persist", () => ({ CommunityRepositoryChangedError, persistCommunityReviewToPR: async () => { if (scenario === "worker-job-transferred") job.organizationId = "other-org"; throw new CommunityRepositoryChangedError(); } }));
mock.module("@/lib/repository-index-completion", () => ({ runRepositoryIndex: () => { throw new Error("unexpected index"); } }));
mock.module("@/lib/review-core", () => ({ generateLocalReview: async () => { generated++; if (scenario === "worker-cancelled-after-generation") job.status = "cancelled"; return { summary: "synthetic", findings: [], model: "synthetic" }; } }));
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
if (scenario !== "action") {
  const { processCommunityReview } = await import("@/lib/community-review");
  if (scenario === "worker-cancelled") await processCommunityReview(job.id);
  else await assert.rejects(() => processCommunityReview(job.id), CommunityRepositoryChangedError);
  assert.equal(job.status, scenario === "worker-job-transferred" ? "reviewing" : scenario.startsWith("worker-cancelled") ? "cancelled" : "failed");
  assert.equal(job.githubToken, scenario === "worker-job-transferred" ? "synthetic" : null);
} else {
  const { POST } = await import("@/app/api/github-action/review/route");
  const response = await POST(new Request("https://example.invalid/api/github-action/review", { method: "POST", body: JSON.stringify({
    owner: "synthetic", repo: "repo", prNumber: 1, diff: "synthetic", githubToken: "synthetic",
  }) }) as never);
  assert.equal(response.status, 500);
}
assert.equal(generated, scenario === "worker-cancelled" ? 0 : 1);
assert.equal(events, ["worker-no-pr", "worker-cancelled-after-generation"].includes(scenario) ? 1 : 0);
