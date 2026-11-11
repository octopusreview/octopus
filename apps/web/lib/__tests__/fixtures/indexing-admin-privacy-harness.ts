import { mock } from "bun:test";
import assert from "node:assert/strict";

mock.module("server-only", () => ({}));
const emitted: string[] = [];
const warnings: unknown[][] = [];
mock.module("@/lib/pubby", () => ({ pubby: { trigger: async (_channel: string, event: string, data: { message: string }) => {
  if (event === "index-log") { emitted.push(data.message); throw new Error("synthetic-private-notification-error"); }
} } }));
mock.module("@/lib/elasticsearch", () => ({ deleteSyncLogs: async () => {}, writeSyncLog: async () => {} }));
mock.module("@/lib/indexing-abort", () => ({ createAbortController: () => new AbortController(), abortIndexing: () => {} }));
mock.module("@/lib/indexing-runner", () => ({ runIndexingInBackground: (_id: string, _name: string, _branch: string, _org: string, _installation: number, _channel: string, emit: (message: string) => void) => {
  emit("Processed 5 files, skipped 0"); emit("Error at /private/path synthetic-token");
} }));
const repo = { id: "repo", fullName: "team/repo", provider: "github", defaultBranch: "main", installationId: 1, indexStatus: "pending", indexAttemptId: null, updatedAt: new Date(), organizationId: "org", organization: { githubInstallationId: 1 } };
mock.module("@octopus/db", () => ({ prisma: { repository: { findUnique: async () => repo, updateMany: async () => ({ count: 1 }) } } }));
process.env.ADMIN_API_SECRET = "synthetic-admin";
const { POST } = await import("@/app/api/admin/repositories/[id]/reindex/route");
const params = Promise.resolve({ id: "repo" });
const makeRequest = (token: string) => new Request("http://localhost/api/admin/repositories/repo/reindex", { method: "POST", headers: { authorization: `Bearer ${token}` } });
assert.equal((await POST(makeRequest("wrong") as never, { params })).status, 401);
assert.equal(emitted.length, 0);
const originalWarn = console.warn;
console.warn = (...args) => { warnings.push(args); };
try {
  assert.equal((await POST(makeRequest("synthetic-admin") as never, { params })).status, 200);
  await Promise.resolve();
  assert.deepEqual(emitted, ["Processed 5 files, skipped 0", "Indexing message withheld for privacy."]);
  assert.deepEqual(warnings, [["[repository-index] log notification failed"], ["[repository-index] log notification failed"]]);
} finally { console.warn = originalWarn; }
