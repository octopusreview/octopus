import { mock } from "bun:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let session = true;
let memberships: Array<{ id: string; organizationId: string; userId: string; deletedAt: Date | null }> = [
  { id: "member", organizationId: "org", userId: "user", deletedAt: null },
];
let repository: { id: string; organizationId: string; indexAttemptId: string | null; syncLogAttemptId: string | null; localIndexUpload?: unknown } | null = {
  id: "repo", organizationId: "org", indexAttemptId: "current", syncLogAttemptId: "current",
};
const calls: Array<[string, string, number, string | undefined]> = [];
const oldLog = { orgId: "org", repoId: "repo", indexAttemptId: "old", message: "old", level: "info", timestamp: 1 };
const currentLog = { orgId: "org", repoId: "repo", indexAttemptId: "current", message: "synthetic-secret", level: "success", timestamp: 2 };
const legacyLog = { orgId: "org", repoId: "repo", message: "synthetic-private-path", level: "info", timestamp: 3, extra: "synthetic-secret" };
const localLog = { orgId: "org", repoId: "repo", indexAttemptId: "upload", message: "synthetic-secret", level: "info", timestamp: 4 };
const safeCurrent = { orgId: "org", repoId: "repo", indexAttemptId: "current", message: "Saved indexing message withheld for privacy.", level: "success", timestamp: 2 };
const safeLegacy = { orgId: "org", repoId: "repo", message: "Saved indexing message withheld for privacy.", level: "info", timestamp: 3 };
const safeLocal = { orgId: "org", repoId: "repo", indexAttemptId: "upload", message: "Saved indexing message withheld for privacy.", level: "info", timestamp: 4 };
const attemptLogs = [oldLog, currentLog, localLog];
const legacyLogs = [legacyLog];
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({ headers: async () => new Headers() }));
mock.module("@/lib/auth", () => ({ auth: { api: { getSession: async () => session ? { user: { id: "user" } } : null } } }));
mock.module("@/lib/elasticsearch", () => ({ getSyncLogs: async (...args: [string, string, number, string | undefined]) => {
  calls.push(args);
  const [orgId, repoId, limit, attempt] = args;
  const logs = attempt ? attemptLogs.filter(log => log.indexAttemptId === attempt) : legacyLogs;
  return logs.filter(log => log.orgId === orgId && log.repoId === repoId).slice(0, limit);
} }));
mock.module("@octopus/db", () => ({ prisma: {
  organizationMember: { findFirst: async ({ where }: { where: Partial<(typeof memberships)[number]> }) =>
    memberships.find(member => Object.entries(where).every(([key, value]) => member[key as keyof typeof member] === value)) ?? null },
  repository: {
    findFirst: async ({ where }: { where: { id: string; organizationId: string } }) =>
      repository?.id === where.id && repository.organizationId === where.organizationId ? repository : null,
    findUnique: async ({ where }: { where: { id: string } }) => repository?.id === where.id ? repository : null,
  },
} }));
const { GET: getUserLogs } = await import("@/app/api/sync-logs/route");
const { GET: getAdminLogs } = await import("@/app/api/admin/repositories/[id]/sync-logs/route");
const userRequest = () => new NextRequest("http://localhost/api/sync-logs?orgId=org&repoId=repo");
process.env.ADMIN_API_SECRET = "synthetic-admin-secret";
const adminRequest = (authorized = true) => new NextRequest("http://localhost/api/admin/repositories/repo/sync-logs", { headers: authorized ? { authorization: "Bearer synthetic-admin-secret" } : {} });
const adminParams = { params: Promise.resolve({ id: "repo" }) };

const currentUserResponse = await getUserLogs(userRequest());
const currentAdminResponse = await getAdminLogs(adminRequest(), adminParams);
assert.equal(currentUserResponse.status, 200);
assert.equal(currentAdminResponse.status, 200);
assert.deepEqual(await currentUserResponse.json(), { logs: [safeCurrent], attempt: "current", indexAttemptId: "current" });
assert.deepEqual(await currentAdminResponse.json(), { logs: [safeCurrent] });
assert.deepEqual(calls.splice(0), [["org", "repo", 500, "current"], ["org", "repo", 500, "current"]]);
for (const [attempt, marker] of [["old-binary", "current"], [null, "current"], ["legacy", null]] as const) {
  repository = { id: "repo", organizationId: "org", indexAttemptId: attempt, syncLogAttemptId: marker };
  const userResponse = await getUserLogs(userRequest());
  const adminResponse = await getAdminLogs(adminRequest(), adminParams);
  assert.equal(userResponse.status, 200);
  assert.equal(adminResponse.status, 200);
  assert.deepEqual(await userResponse.json(), { logs: [safeLegacy], attempt: null, indexAttemptId: attempt });
  assert.deepEqual(await adminResponse.json(), { logs: [safeLegacy] });
  assert.deepEqual(calls.splice(0), [["org", "repo", 500, undefined], ["org", "repo", 500, undefined]]);
}
for (const batch of [null, "batch"] as const) {
  repository = { id: "repo", organizationId: "org", indexAttemptId: batch, syncLogAttemptId: "upload", localIndexUpload: { id: "upload", batchAttemptId: batch, paths: ["synthetic-private-path"] } };
  const userResponse = await getUserLogs(userRequest());
  const adminResponse = await getAdminLogs(adminRequest(), adminParams);
  assert.deepEqual(await userResponse.json(), { logs: [safeLocal], attempt: "upload", indexAttemptId: batch });
  assert.deepEqual(await adminResponse.json(), { logs: [safeLocal] });
  assert.deepEqual(calls.splice(0), [["org", "repo", 500, "upload"], ["org", "repo", 500, "upload"]]);
}
for (const state of [{ id: "old-upload", batchAttemptId: "batch" }, { id: "upload", batchAttemptId: "old-batch" }, null]) {
  repository = { id: "repo", organizationId: "org", indexAttemptId: "batch", syncLogAttemptId: "upload", localIndexUpload: state };
  assert.deepEqual(await (await getUserLogs(userRequest())).json(), { logs: [safeLegacy], attempt: null, indexAttemptId: "batch" });
  assert.deepEqual(await (await getAdminLogs(adminRequest(), adminParams)).json(), { logs: [safeLegacy] });
  assert.deepEqual(calls.splice(0), [["org", "repo", 500, undefined], ["org", "repo", 500, undefined]]);
}
for (const [batch, upload, selected] of [
  ["batch-a", { id: "upload", batchAttemptId: "batch-a" }, "upload"],
  [null, { id: "upload", batchAttemptId: null }, "upload"],
  ["batch-b", { id: "upload", batchAttemptId: "batch-b" }, "upload"],
  [null, { id: "upload", batchAttemptId: null }, "upload"],
  ["replacement", { id: "upload", batchAttemptId: null }, undefined],
  ["batch-c", { id: "replacement-upload", batchAttemptId: "batch-c" }, undefined],
] as const) {
  repository = { id: "repo", organizationId: "org", indexAttemptId: batch, syncLogAttemptId: "upload", localIndexUpload: upload };
  await getUserLogs(userRequest());
  await getAdminLogs(adminRequest(), adminParams);
  assert.deepEqual(calls.splice(0), [["org", "repo", 500, selected], ["org", "repo", 500, selected]]);
}
const safeTexts = ["Processed 5 files, skipped 0", "Processing files... 3/10", "Processing embedding batch 2/5...", "Repository cloned successfully", "Generating embeddings for 5 chunks (1 batch)...", "Storing 5 vectors in database (2 batches)...", "Local indexing started", "Local indexing batch complete", "Local indexing complete", "Indexing failed", "Processing local batch 1/2"];
const unsafeTexts = ["synthetic-secret", "/private/synthetic/file.ts", "Processed 5 files, skipped 0 synthetic-secret", "Processed 5 files, skipped 0\n", "Indexing failed: synthetic-secret", "Processing local batch 1/2 synthetic-secret", "Local indexing complete\nsynthetic-secret"];
for (const attempt of [undefined, "current"] as const) {
  repository = { id: "repo", organizationId: "org", indexAttemptId: attempt ?? "legacy", syncLogAttemptId: attempt ?? null };
  const target = attempt ? attemptLogs : legacyLogs;
  const original = target.splice(0);
  for (const message of [...safeTexts, ...unsafeTexts]) target.push({ orgId: "org", repoId: "repo", ...(attempt ? { indexAttemptId: attempt } : {}), message, level: "info", timestamp: 99 } as never);
  const expected = [...safeTexts, ...unsafeTexts.map(() => "Saved indexing message withheld for privacy.")];
  for (const response of [await getUserLogs(userRequest()), await getAdminLogs(adminRequest(), adminParams)]) {
    const body = await response.json();
    assert.deepEqual(body.logs.map((log: { message: string }) => log.message), expected);
    assert.ok(body.logs.every((log: Record<string, unknown>) => Object.keys(log).every(key => ["orgId", "repoId", "indexAttemptId", "message", "level", "timestamp"].includes(key))));
  }
  target.splice(0, target.length, ...original as never[]);
  calls.splice(0);
}
repository = { id: "repo", organizationId: "other", indexAttemptId: "current", syncLogAttemptId: "current" };
assert.deepEqual(await (await getUserLogs(userRequest())).json(), { logs: [] });
assert.equal(calls.length, 0);
repository = { id: "repo", organizationId: "org", indexAttemptId: "current", syncLogAttemptId: "current" };
for (const membership of [
  { id: "member", organizationId: "other", userId: "user", deletedAt: null },
  { id: "member", organizationId: "org", userId: "other", deletedAt: null },
  { id: "member", organizationId: "org", userId: "user", deletedAt: new Date("2020-01-01T00:00:00Z") },
]) {
  memberships = [membership];
  assert.equal((await getUserLogs(userRequest())).status, 403);
  assert.equal(calls.length, 0);
}
session = false;
assert.equal((await getUserLogs(userRequest())).status, 401);
assert.equal((await getAdminLogs(adminRequest(false), adminParams)).status, 401);
assert.equal(calls.length, 0);
