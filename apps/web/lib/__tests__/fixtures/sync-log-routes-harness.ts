import { mock } from "bun:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let session = true;
let member = true;
let repository: { id: string; organizationId: string; indexAttemptId: string | null; syncLogAttemptId: string | null } | null = {
  id: "repo", organizationId: "org", indexAttemptId: "current", syncLogAttemptId: "current",
};
const calls: Array<[string, string, number, string | undefined]> = [];
const oldLog = { orgId: "org", repoId: "repo", indexAttemptId: "old", message: "old", level: "info", timestamp: 1 };
const currentLog = { orgId: "org", repoId: "repo", indexAttemptId: "current", message: "current", level: "success", timestamp: 2 };
const legacyLog = { orgId: "org", repoId: "repo", message: "legacy", level: "info", timestamp: 3 };
const attemptLogs = [oldLog, currentLog];
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
  organizationMember: { findFirst: async () => member ? { id: "member" } : null },
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
assert.deepEqual(await currentUserResponse.json(), { logs: [currentLog], attempt: "current" });
assert.deepEqual(await currentAdminResponse.json(), { logs: [currentLog] });
assert.deepEqual(calls.splice(0), [["org", "repo", 500, "current"], ["org", "repo", 500, "current"]]);
for (const [attempt, marker] of [["old-binary", "current"], [null, "current"], ["legacy", null]] as const) {
  repository = { id: "repo", organizationId: "org", indexAttemptId: attempt, syncLogAttemptId: marker };
  const userResponse = await getUserLogs(userRequest());
  const adminResponse = await getAdminLogs(adminRequest(), adminParams);
  assert.equal(userResponse.status, 200);
  assert.equal(adminResponse.status, 200);
  assert.deepEqual(await userResponse.json(), { logs: [legacyLog], attempt: null });
  assert.deepEqual(await adminResponse.json(), { logs: [legacyLog] });
  assert.deepEqual(calls.splice(0), [["org", "repo", 500, undefined], ["org", "repo", 500, undefined]]);
}
repository = { id: "repo", organizationId: "other", indexAttemptId: "current", syncLogAttemptId: "current" };
assert.deepEqual(await (await getUserLogs(userRequest())).json(), { logs: [] });
assert.equal(calls.length, 0);
member = false;
assert.equal((await getUserLogs(userRequest())).status, 403);
session = false;
assert.equal((await getUserLogs(userRequest())).status, 401);
assert.equal((await getAdminLogs(adminRequest(false), adminParams)).status, 401);
assert.equal(calls.length, 0);
