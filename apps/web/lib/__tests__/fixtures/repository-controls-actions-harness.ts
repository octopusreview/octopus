import { mock } from "bun:test";
import assert from "node:assert/strict";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => ({ value: "org" }) }) }));
mock.module("next/navigation", () => ({ redirect: () => { throw new Error("Unexpected redirect"); } }));
mock.module("next/cache", () => ({ revalidatePath() {} }));
mock.module("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: "user" } }) } } }));
const notifications: Array<{ event: string; data: { message?: string } }> = [];
mock.module("@/lib/pubby", () => ({ pubby: { trigger: async (_channel: string, event: string, data: { message?: string }) => { notifications.push({ event, data }); } } }));
mock.module("@/lib/elasticsearch", () => ({ writeSyncLog() {}, deleteSyncLogs: async () => {} }));
mock.module("@/lib/github", () => ({ GithubRateLimitError: class extends Error {} }));
mock.module("@/lib/repo-sync", () => ({ syncOrgRepos: async () => ({}), syncForgejoRepos: async () => ({}) }));
mock.module("@/lib/org-create", () => ({ WELCOME_DEFERRED_REASON: "fixture" }));
mock.module("@/lib/org-limits", () => ({ canUserCreateOrg() {}, hasEverOwnedOrg() {} }));
mock.module("@/lib/welcome-credit", () => ({ assessWelcomeCredit() {}, logWelcomeOutcome() {} }));
mock.module("@/lib/crypto", () => ({ encryptString() {} }));
mock.module("@/lib/providers/url-validation", () => ({ validateProviderUrl() {} }));
mock.module("@/lib/providers/thinking", () => ({ asThinkingEffort() {} }));
mock.module("@/lib/audit", () => ({ writeAuditLog() {} }));
mock.module("@/lib/entitlements", () => ({ canUseLiveTelemetry() {} }));
mock.module("@/lib/request-ip", () => ({ getClientIp() {} }));
mock.module("@/lib/presence", () => ({ clearPresence() {} }));
mock.module("@/lib/events/bus", () => ({ eventBus: { emit() {} } }));
let starts = 0;
let extraLogs: string[] = [];
let pausedProbeFlag: unknown;
let aborts = 0;
let replaceBeforeCancel = false;
let abortedAttempt: string | undefined;
mock.module("@/lib/indexing-abort", () => ({ createAbortController: () => new AbortController(), abortIndexing: (attempt: string) => { aborts++; abortedAttempt = attempt; return true; } }));
mock.module("@/lib/indexing-runner", () => ({ runIndexingInBackground: async (...args: unknown[]) => { starts++; pausedProbeFlag = args[10]; const emit = args[6] as (value: string) => void; emit("Processed 5 files, skipped 0"); emit("Error /private/path synthetic-token"); emit("synthetic-private-path synthetic-secret"); emit("Processing local batch 1/2"); for (const message of extraLogs) emit(message); } }));

const row = {
  id: "repo", fullName: "team/project", provider: "github", isActive: true, dismissedAt: null as Date | null,
  defaultBranch: "main", installationId: 1 as number | null, indexStatus: "pending", indexedAt: null as Date | null,
  indexAttemptId: null as string | null,
  updatedAt: new Date(), organizationId: "org", autoReview: true,
  organization: { githubInstallationId: 1 as number | null, members: [{ role: "owner", scopes: [] as string[] }] },
};
let exists = true;
let connected = false;
let connectorReady = true;
const writes: Record<string, unknown>[] = [];
mock.module("@octopus/db", () => ({ prisma: {
  repository: {
    findUnique: async () => exists ? { ...row } : null,
    updateMany: async ({ where, data }: { where: { indexStatus: string; indexAttemptId?: string | null; updatedAt?: Date }; data: Record<string, unknown> }) => {
      if (replaceBeforeCancel && data.indexStatus === "pending") {
        replaceBeforeCancel = false;
        row.indexAttemptId = "replacement";
      }
      if (where.indexStatus !== row.indexStatus || (where.indexAttemptId !== undefined && where.indexAttemptId !== row.indexAttemptId)
        || (where.updatedAt && where.updatedAt.getTime() !== row.updatedAt.getTime())) return { count: 0 };
      writes.push(data); Object.assign(row, data); return { count: 1 };
    },
    update: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); Object.assign(row, data); return row; },
  },
  bitbucketIntegration: { findUnique: async () => connected ? { id: "connection" } : null },
  gitlabIntegration: { findUnique: async () => connected ? { id: "connection" } : null },
  forgejoIntegration: { findUnique: async () => connected ? { id: "connection", username: connectorReady ? "bot" : "", connectorError: null } : null },
} }));

const { indexRepository, cancelIndexing } = await import("@/app/(app)/actions");
const { toggleAutoReview } = await import("@/app/(app)/repositories/actions");
exists = false;
for (const action of [() => indexRepository("repo"), () => cancelIndexing("repo"), () => toggleAutoReview("repo", false)]) {
  assert.match((await action()).error!, /not found/);
}
exists = true;
row.organization.members[0].role = "member";
assert.match((await indexRepository("repo")).error!, /owners and admins/);
assert.match((await cancelIndexing("repo")).error!, /owners and admins/);
assert.match((await toggleAutoReview("repo", false)).error!, /owners and admins/);
assert.equal(row.autoReview, true);
assert.equal(writes.length, 0);
assert.equal(starts + aborts, 0);
row.organization.members[0].role = "owner";
for (const status of ["pending", "indexing", "failed", "indexed"]) {
  row.indexStatus = status;
  assert.deepEqual(await toggleAutoReview("repo", false), {});
  assert.equal(row.autoReview, false, `must allow disabling during ${status}`);
  assert.deepEqual(await toggleAutoReview("repo", true), {});
  assert.equal(row.autoReview, true);
}
writes.length = 0;
row.isActive = false;
assert.match((await indexRepository("repo")).error!, /disconnected or removed/);
row.isActive = true;
row.dismissedAt = new Date();
assert.match((await indexRepository("repo")).error!, /disconnected or removed/);
row.dismissedAt = null;
row.installationId = row.organization.githubInstallationId = null;
for (const provider of ["github", "bitbucket", "gitlab", "forgejo"]) {
  row.provider = provider;
  assert.match((await indexRepository("repo")).error!, /disconnected/);
}
connected = true;
connectorReady = false;
assert.match((await indexRepository("repo")).error!, /not ready/);
assert.equal(starts, 0);
assert.equal(writes.length, 0);
connectorReady = true;
row.indexedAt = new Date();
assert.match((await indexRepository("repo")).error!, /Please wait/);
assert.equal(starts, 0);
row.indexedAt = null;
row.indexStatus = "pending";
row.autoReview = false;
assert.deepEqual(await indexRepository("repo"), {});
assert.equal(starts, 1);
assert.equal(pausedProbeFlag, true, "an authorized repository manager may request one paused-limit probe");
assert.deepEqual(notifications.filter(item => item.event === "index-log").map(item => item.data.message), ["Processed 5 files, skipped 0", "Indexing message withheld for privacy.", "Indexing message withheld for privacy.", "Processing local batch 1/2"]);
assert.doesNotMatch(JSON.stringify(notifications), /synthetic-private-path|synthetic-secret|synthetic-token|private\/path/);
assert.equal(row.autoReview, false, "manual indexing must preserve disabled automatic reviews");
assert.equal(row.indexStatus, "indexing");
const attempt = row.indexAttemptId;
assert.ok(attempt);
assert.deepEqual(await cancelIndexing("repo"), {});
assert.equal(abortedAttempt, attempt);
assert.equal(row.indexStatus, "pending");
assert.equal(aborts, 1);
row.indexStatus = "indexing";
replaceBeforeCancel = true;
assert.match((await cancelIndexing("repo")).error!, /no longer current/);
assert.equal(aborts, 1);
assert.equal(row.indexStatus, "indexing");
assert.equal(row.indexAttemptId, "replacement");
row.indexStatus = "indexed";
assert.match((await cancelIndexing("repo")).error!, /not currently indexing/);
// A repository GitHub has blocked stays "failed": a manual retry must still run,
// and the customer must see the reason rather than a withheld line.
const blockMessage = "GitHub has blocked access to this repository, so it cannot be indexed.";
Object.assign(row, { provider: "github", installationId: 1, indexStatus: "failed", indexedAt: null, indexBlockedAt: new Date() });
replaceBeforeCancel = false;
notifications.length = 0;
extraLogs = [blockMessage, `${blockMessage} team/project synthetic-secret`];
const startsBeforeBlockedRetry = starts;
assert.deepEqual(await indexRepository("repo"), {}, "a blocked repository can be retried by hand");
assert.equal(starts, startsBeforeBlockedRetry + 1);
assert.equal(row.indexStatus, "indexing");
const blockedRetryLogs = notifications.filter(item => item.event === "index-log").map(item => item.data.message);
assert.deepEqual(blockedRetryLogs.slice(-2), [blockMessage, "Indexing message withheld for privacy."]);
console.log("Repository action permission, readiness, cooldown, toggle and indexing checks passed");
