import { mock } from "bun:test";
import assert from "node:assert/strict";

const events: Array<{ contexts?: Record<string, Record<string, unknown>> }> = [];
mock.module("@sentry/nextjs", () => ({ captureEvent: (event: typeof events[number]) => { events.push(event); return "e".repeat(32); } }));
for (const [path, names] of Object.entries({
  "forgejo-connector": ["cleanupForgejoConnectorRequests"], "emails/welcome": ["sendWelcomeEmail"],
  "large-review-result": ["handleLargeReviewResult"],
  audit: ["enforceAuditLogRetention", "enforceActivityEventRetention"], "webhook-tenant": ["enforceWebhookDeliveryRetention"],
  releases: ["refreshReleaseCache"], subscription: ["renewDueSubscriptions"], credits: ["reconcileAutoReloadAttempts"],
  "marketing-outbox": ["syncMarketingConversions"], "ollama-admin": ["runOllamaPull"],
  "discover-repositories": ["discoverRepositories"],
})) mock.module(`../../${path}`, () => Object.fromEntries(names.map(name => [name, () => { throw new Error("Unexpected unrelated job"); }])));
let reaperCalls = 0;
mock.module("../../reap-stuck-reviews", () => ({ reapStuckReviews: async () => { reaperCalls++; return { requeued: 0, failed: 0 }; } }));
mock.module("../../github-deferred-index", () => ({ dispatchDeferredIndexes: async () => { throw new Error("synthetic private dispatch details"); } }));
const communityError = Object.assign(new Error("synthetic-community-secret-request-id"), { status: 503 });
mock.module("../../community-review", () => ({ processCommunityReview: async () => { throw communityError; } }));
const reviewCalls: unknown[][] = [];
let reviewError: Error | undefined;
mock.module("../../reviewer", () => ({ processReview: async (...args: unknown[]) => {
  reviewCalls.push(args); if (reviewError) throw reviewError;
} }));
mock.module("../../repository-index-job", () => ({ processRepositoryIndex: async () => { throw new DOMException("Deadline", "TimeoutError"); } }));
const { registerWorkers } = await import("../../queue-workers");
const callbacks = new Map<string, (jobs: unknown[]) => Promise<void>>();
await registerWorkers({ work: async (name: string, ...args: unknown[]) => { callbacks.set(name, args.at(-1) as never); } } as never,
  { reviewConcurrency: 1 } as never);
const reaperLogs: unknown[][] = [];
const originalReaperError = console.error;
console.error = (...args: unknown[]) => { reaperLogs.push(args); };
try { await callbacks.get("reap-stuck-reviews")!([{ id: "sweep" }]); }
finally { console.error = originalReaperError; }
assert.equal(reaperCalls, 1, "a failed deferred-index sweep must not disable the review reaper");
assert.equal(JSON.stringify(reaperLogs).includes("synthetic private dispatch details"), false);
const communityLogs: unknown[][] = [];
const originalCommunityError = console.error;
console.error = (...args: unknown[]) => { communityLogs.push(args); };
try {
  await assert.rejects(() => callbacks.get("community-review")!([{ id: "queue-job", data: { jobId: "community-job" } }]), error => error === communityError);
  assert.deepEqual(communityLogs[0][1], { name: "Error", status: 503 });
  assert.equal(JSON.stringify(communityLogs).includes("synthetic-community-secret-request-id"), false);
} finally { console.error = originalCommunityError; }
const job = { id: "job", data: { pullRequestId: "pr", repositoryId: "repo" }, retryCount: 1, retryLimit: 2,
  startedOn: new Date(), expireInSeconds: 900, signal: new AbortController().signal };
await callbacks.get("process-review")!([job]);
assert.equal(reviewCalls[0][2], 1);
assert.equal((reviewCalls[0][1] as { signal: AbortSignal }).signal, job.signal);
assert.equal(events.length, 0);
await assert.rejects(() => callbacks.get("index-repository")!([job]), { name: "TimeoutError" });
assert.equal(events.length, 0);
job.retryCount = 2;
await assert.rejects(() => callbacks.get("index-repository")!([job]), { name: "TimeoutError" });
assert.equal(events.length, 1);
assert.equal(events[0].contexts?.background_failure?.retryCount, 2);
reviewError = new Error("Review failed before handled boundary");
const controller = new AbortController(); controller.abort(); job.signal = controller.signal;
const log = console.error; console.error = () => {};
try {
  await assert.rejects(() => callbacks.get("process-review")!([job]));
  assert.equal(events.length, 1);
  job.startedOn = new Date(Date.now() - 901000);
  assert.equal(job.signal.reason.name, "AbortError");
  await assert.rejects(() => callbacks.get("process-review")!([job]));
  assert.equal(events.length, 2);
  reviewError = new Error("Another expired attempt");
  job.retryCount = 1;
  await assert.rejects(() => callbacks.get("process-review")!([job]));
  assert.equal(events.length, 2);
  job.retryCount = 2;
  job.startedOn = new Date(NaN);
  await assert.rejects(() => callbacks.get("process-review")!([job]));
  assert.equal(events.length, 3, "missing deadline evidence must not claim cancellation");
  reviewError = new Error("Uncancelled failure");
  job.startedOn = new Date();
  job.signal = new AbortController().signal;
  await assert.rejects(() => callbacks.get("process-review")!([job]));
  assert.equal(events.length, 4);
} finally { console.error = log; }
