import assert from "node:assert/strict";
import { mock } from "bun:test";
import { NextRequest } from "next/server";

let signedIn = true;
let callerRole = "owner";
let targetRole = "member";
let targetUser = "user_2";
const reads: unknown[] = [];
const writes: unknown[] = [];
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({ headers: async () => new Headers() }));
mock.module("@/lib/auth", () => ({ auth: { api: { getSession: async () => signedIn ? { user: { id: "user_1" } } : null } } }));
mock.module("@/lib/audit", () => ({ writeAuditLog: async () => {} }));
mock.module("@octopus/db", () => ({ prisma: { organizationMember: {
  findFirst: async ({ where }: { where: { organizationId: string; userId?: string; id?: string; deletedAt: null } }) => {
    reads.push(where);
    assert.equal(where.deletedAt, null);
    if (where.organizationId !== "org_1") return null;
    if (where.userId) { assert.equal(where.userId, "user_1"); return { role: callerRole, scopes: [] }; }
    return { id: "member_2", userId: targetUser, role: targetRole, scopes: [] };
  },
  update: async (args: unknown) => { writes.push(args); return { id: "member_2" }; },
} } }));
const { PATCH } = await import("@/app/api/orgs/[orgId]/members/[memberId]/route");
const call = (body: string, orgId = "org_1", memberId = "member_2") => PATCH(new NextRequest("https://octopus.example/api/test", {
  method: "PATCH", body, headers: { "content-type": "application/json" },
}), { params: Promise.resolve({ orgId, memberId }) });
for (const body of ["-", "", "{", "null", "[]", "42", '"text"', "{}", '{"role":null}', '{"scopes":"admin"}']) {
  reads.length = 0;
  assert.equal((await call(body)).status, 400);
  assert.deepEqual(reads, []);
  assert.deepEqual(writes, []);
}
assert.equal((await call(JSON.stringify({ role: "x".repeat(65537) }))).status, 413);
for (const id of ["", "nul\0value", "x".repeat(1025)]) {
  reads.length = 0;
  assert.equal((await call('{"role":"admin"}', id)).status, 400);
  assert.equal((await call('{"role":"admin"}', "org_1", id)).status, 400);
  assert.deepEqual(reads, []);
}
signedIn = false;
assert.equal((await call("-")).status, 401);
signedIn = true;
assert.equal((await call('{"role":"admin"}', "other_org")).status, 403);
callerRole = "member";
assert.equal((await call('{"role":"admin"}')).status, 403);
callerRole = "owner";
targetRole = "owner";
assert.equal((await call('{"role":"admin"}')).status, 400);
targetRole = "member"; targetUser = "user_1";
assert.equal((await call('{"role":"admin"}')).status, 400);
assert.deepEqual(writes, []);
targetUser = "user_2";
assert.equal((await call('{"role":"admin"}')).status, 200);
assert.equal(writes.length, 1);
console.log("input validation checks passed");
