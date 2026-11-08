import { mock } from "bun:test";
import assert from "node:assert/strict";

const mode = process.argv[2];
const summaryFailure = mode.endsWith("-summary");
const marker = "synthetic-private-path-and-secret";
const output: string[] = [];
const updates: Array<Record<string, unknown>> = [];
const org = { id: "org" };
const repo = { id: "repo", organizationId: org.id, provider: "github", externalId: "fixture-id", fullName: "fixture/repo", defaultBranch: "main", indexStatus: "pending", indexedAt: null };
const job = { id: "job", repositoryId: repo.id, organizationId: org.id, status: "pending", expiresAt: new Date(Date.now() + 60_000), postMode: "bot_account", repoFullName: repo.fullName, diff: "diff --git a/a b/a\n", prNumber: null };
const jobUpdate = async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); };
const jobUpdateMany = async (args: { data: Record<string, unknown> }) => { await jobUpdate(args); return { count: 1 }; };
mock.module("server-only", () => ({}));
mock.module("@octopus/db", () => ({ prisma: {
  communityReviewJob: { findUnique: async () => job, findFirst: async () => ({ id: job.id }), update: jobUpdate, updateMany: jobUpdateMany },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ $queryRaw: async () => [repo], communityReviewJob: { updateMany: async (args: { data: Record<string, unknown> }) => { await jobUpdate(args); return { count: 1 }; } } }),
  repository: { findUnique: async () => repo, updateMany: async () => ({ count: 1 }), upsert: async () => repo, update: async () => {} },
  pullRequest: { count: async () => 0 },
} }));
mock.module("@/lib/repository-index-completion", () => ({ runRepositoryIndex: async (_repo: string, _attempt: string, fn: () => Promise<unknown>) => fn() }));
mock.module("@/lib/indexer", () => ({ indexRepository: async (...args: unknown[]) => {
  const log = args[4] as (message: string, level: string) => void;
  log(marker, "error");
  if (summaryFailure) return { indexedFiles: 1, totalVectors: 1 };
  throw new Error(marker);
} }));
mock.module("@/lib/review-core", () => ({ generateLocalReview: async () => ({ findings: [], summary: "Synthetic review", model: "fixture" }) }));
mock.module("@/lib/summarizer", () => ({ summarizeRepository: async () => { throw new Error(marker); } }));
mock.module("@/lib/analyzer", () => ({ analyzeRepository: async () => { throw new Error(marker); } }));
mock.module("@/lib/github", () => ({ getRepositoryTree: async () => [], getPullRequestDiff: async () => "" }));
mock.module("@/lib/events/bus", () => ({ eventBus: { emit: () => {} } }));
mock.module("@/lib/queue", () => ({ enqueue: async () => "fixture" }));
mock.module("@/lib/community-pr-persist", () => ({ CommunityRepositoryChangedError: class extends Error {}, persistCommunityReviewToPR: async () => {} }));
mock.module("@/lib/crypto", () => ({ decryptString: (text: string) => text, encryptString: (text: string) => text }));
mock.module("@/lib/oss-bot", () => ({ getBotToken: () => "fixture-token" }));
mock.module("@/lib/oss-review-post", () => ({ postOssReview: async () => ({ posted: 0, skipped: 0 }) }));
mock.module("@/lib/api-auth", () => ({ authenticateApiToken: async () => ({ org }) }));
mock.module("@/lib/cost", () => ({ isOrgOverSpendLimit: async () => false }));
mock.module("@/lib/external-review-activity", () => ({ withExternalReviewActivity: async (_meta: unknown, fn: () => Promise<unknown>) => fn() }));
globalThis.fetch = (async () => Response.json({ id: 1, default_branch: "main", private: false, full_name: repo.fullName })) as typeof fetch;
const originalLog = console.log;
const originalError = console.error;
console.log = (...args: unknown[]) => { output.push(args.map(String).join(" ")); };
console.error = (...args: unknown[]) => { output.push(args.map(String).join(" ")); };
try {
  if (mode.startsWith("community")) {
    const { processCommunityReview } = await import("@/lib/community-review");
    await processCommunityReview(job.id);
    assert.ok(updates.some(update => update.status === "completed"));
  } else {
    const { POST } = await import("@/app/api/github-action/review/route");
    const response = await POST(new Request("http://localhost/api/github-action/review", {
      method: "POST", headers: { "x-octopus-action-secret": process.env.OCTOPUS_ACTION_SECRET ?? "" },
      body: JSON.stringify({ owner: "fixture", repo: "repo", githubToken: "fixture-token", diff: job.diff }),
    }) as never);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).indexed, summaryFailure);
  }
  assert.ok(output.some(line => line.includes(summaryFailure ? "summarize failed" : "indexing failed")));
  if (summaryFailure) assert.ok(output.some(line => line.includes("analyze failed")));
  assert.doesNotMatch(output.join("\n"), new RegExp(marker));
} finally {
  console.log = originalLog;
  console.error = originalError;
}
