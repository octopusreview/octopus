import { mock } from "bun:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";

const scenario = process.argv[2];
const marker = "synthetic-provider-secret";
const requestId = "req_syntheticsecret123";
const community = ["community", "persistence", "conflict", "audit"].includes(scenario);
const error = Object.assign(new Error(marker, { cause: { message: marker, requestID: requestId } }), { status: 503, request_id: requestId });
let reviews = 0;
let enqueued = 0;
mock.module("server-only", () => ({}));
mock.module("@/lib/external-review-activity", () => ({ withExternalReviewActivity: async (_: unknown, fn: () => Promise<Response>) => fn() }));
mock.module("@/lib/repository-index-completion", () => ({ runRepositoryIndex: async () => {} }));
mock.module("@/lib/api-auth", () => ({ authenticateApiToken: async () => scenario === "denied" ? Response.json({ error: "denied" }, { status: 403 }) : community ? null : { org: { id: "synthetic-org" } } }));
mock.module("@octopus/db", () => ({ prisma: {
  organization: { upsert: async () => ({ id: "synthetic-org", communityDailyReviewLimit: 5 }) },
  repository: { upsert: async () => ({ id: "synthetic-repo", externalId: "1", defaultBranch: "main", indexStatus: scenario === "audit" ? "pending" : "indexed", indexedAt: null }) },
  aiUsage: { count: async () => 0 }, pullRequest: { count: async () => 0 },
  communityReviewJob: { create: async () => ({ id: "synthetic-job" }) }, auditLog: { create: async () => { throw error; } },
} }));
const { AiProviderFailure } = await import("../../provider-failure");
mock.module("@/lib/review-core", () => ({ generateLocalReview: async () => {
  reviews++;
  if (["authenticated", "community"].includes(scenario)) throw error;
  if (scenario === "wrapped") throw new AiProviderFailure(error, "openai", "synthetic", "unknown");
  return { findings: [], summary: "synthetic", model: "synthetic", usage: {} };
} }));
mock.module("@/lib/cost", () => ({ isOrgOverSpendLimit: async () => false }));
mock.module("@/lib/github", () => ({ getRepositoryTree: async () => [] }));
mock.module("@/lib/events/bus", () => ({ eventBus: { emit: () => {} } }));
mock.module("@/lib/queue", () => ({ enqueue: async () => { enqueued++; } }));
class CommunityRepositoryChangedError extends Error {}
mock.module("@/lib/community-pr-persist", () => ({ persistCommunityReviewToPR: async () => {
  if (scenario === "conflict") throw Object.assign(new CommunityRepositoryChangedError(marker), { status: 503 });
  throw error;
}, CommunityRepositoryChangedError }));
mock.module("@/lib/crypto", () => ({ encryptString: () => "synthetic" }));
globalThis.fetch = (async () => Response.json({ id: 1, default_branch: "main", private: false, full_name: "synthetic/repo" })) as typeof fetch;
const captured: unknown[][] = [];
console.error = (...args: unknown[]) => { captured.push(args); };
console.log = () => {};
const { NextRequest } = await import("next/server");
const { POST } = await import("../../../app/api/github-action/review/route");
const request = new NextRequest("http://localhost/api/github-action/review", { method: "POST", headers: community ? {} : { authorization: "Bearer synthetic" }, body: JSON.stringify({ owner: "synthetic", repo: "repo", diff: "+synthetic", githubToken: "synthetic", prNumber: 1 }) });
const response = await POST(request);
const body = await response.text();
assert.ok(!body.includes(marker) && !body.includes(requestId));
assert.ok(!inspect(captured, { depth: 10 }).includes(marker));
assert.ok(!inspect(captured, { depth: 10 }).includes(requestId));
if (scenario === "denied") {
  assert.equal(response.status, 403); assert.equal(reviews, 0); assert.equal(enqueued, 0);
} else if (scenario === "success") {
  assert.equal(response.status, 200); assert.equal(reviews, 1); assert.equal(JSON.parse(body).status, "completed");
  assert.equal(captured.length, 0);
} else if (scenario === "persistence") {
  assert.equal(response.status, 200); assert.equal(reviews, 1); assert.equal(JSON.parse(body).status, "completed");
  assert.equal(captured.length, 1); assert.equal((captured[0][1] as { status?: number }).status, 503);
} else if (scenario === "audit") {
  assert.equal(response.status, 200); assert.equal(reviews, 0); assert.equal(enqueued, 1); assert.equal(JSON.parse(body).status, "queued");
  assert.equal(captured.length, 1); assert.equal((captured[0][1] as { status?: number }).status, 503);
} else {
  assert.equal(response.status, 500); assert.equal(reviews, 1); assert.equal(JSON.parse(body).error, "Review generation failed");
  assert.equal(captured.length, 1); assert.equal((captured[0][1] as { status?: number }).status, 503);
}
