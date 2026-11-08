import { mock } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { localQueueTestDatabaseUrl } from "../queue-test-database";

process.env.DATABASE_URL = localQueueTestDatabaseUrl(process.env.DATABASE_URL);
const suffix = randomUUID();
const userId = `transfer-user-${suffix}`;
let notifications = 0;
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({ headers: async () => new Headers() }));
mock.module("next/navigation", () => ({ redirect: () => { throw new Error("unexpected redirect"); } }));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));
mock.module("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: userId } }) } } }));
mock.module("@/lib/pubby", () => ({ pubby: { trigger: async () => { notifications++; } } }));
mock.module("@/lib/events/bus", () => ({ eventBus: { emit: () => {} } }));
mock.module("@/lib/repo-sync", () => ({ syncForgejoRepos: async () => {} }));
globalThis.fetch = (() => { throw new Error("unexpected external request"); }) as typeof fetch;
const { prisma } = await import("@octopus/db");
const { transferRepository } = await import("@/app/(app)/repositories/actions");
const user = await prisma.user.create({ data: { id: userId, name: "Synthetic", email: `${suffix}@example.invalid` } });
const source = await prisma.organization.create({ data: { name: "Source", slug: `transfer-source-${suffix}` } });
const target = await prisma.organization.create({ data: { name: "Target", slug: `transfer-target-${suffix}` } });
const other = await prisma.organization.create({ data: { name: "Other", slug: `transfer-other-${suffix}` } });
try {
  await prisma.organizationMember.create({ data: { organizationId: source.id, userId, role: "owner" } });
  await prisma.organizationMember.create({ data: { organizationId: target.id, userId, role: "member" } });
  const repo = await prisma.repository.create({ data: { organizationId: source.id, name: "Synthetic", fullName: "synthetic/repo", externalId: suffix, provider: "github", indexStatus: "pending" } });
  const member = prisma.organizationMember;
  const findFirst = member.findFirst.bind(member);
  let afterAdmission: (() => Promise<void>) | undefined;
  member.findFirst = (async (...args: Parameters<typeof findFirst>) => {
    const found = await findFirst(...args);
    const hook = afterAdmission; afterAdmission = undefined;
    await hook?.();
    return found;
  }) as typeof member.findFirst;
  for (const change of ["index-started", "owner-changed", "provider-changed", "source-permission-revoked", "target-membership-revoked", "target-banned"]) {
    await prisma.repository.update({ where: { id: repo.id }, data: { organizationId: source.id, provider: "github", indexStatus: "pending", indexAttemptId: null } });
    await prisma.organizationMember.updateMany({ where: { organizationId: source.id, userId }, data: { role: "owner", scopes: [], deletedAt: null } });
    await prisma.organizationMember.updateMany({ where: { organizationId: target.id, userId }, data: { deletedAt: null } });
    await prisma.organization.update({ where: { id: target.id }, data: { bannedAt: null } });
    notifications = 0;
    afterAdmission = async () => {
      if (change === "source-permission-revoked") await prisma.organizationMember.updateMany({ where: { organizationId: source.id, userId }, data: { role: "member", scopes: [] } });
      else if (change === "target-membership-revoked") await prisma.organizationMember.updateMany({ where: { organizationId: target.id, userId }, data: { deletedAt: new Date() } });
      else if (change === "target-banned") await prisma.organization.update({ where: { id: target.id }, data: { bannedAt: new Date() } });
      else await prisma.repository.update({ where: { id: repo.id }, data: change === "index-started" ? { indexStatus: "indexing", indexAttemptId: "new-attempt" }
        : change === "owner-changed" ? { organizationId: other.id } : { provider: "forgejo" } });
    };
    const result = await transferRepository(repo.id, target.id);
    assert.ok(result.error, `${change} must reject the stale transfer`);
    const current = await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } });
    assert.equal(current.organizationId, change === "owner-changed" ? other.id : source.id);
    if (change === "index-started") assert.deepEqual([current.indexStatus, current.indexAttemptId], ["indexing", "new-attempt"]);
    if (change === "provider-changed") assert.equal(current.provider, "forgejo");
    assert.equal(notifications, 0, "a rejected transfer must not notify either organization");
  }
  await prisma.organization.update({ where: { id: target.id }, data: { bannedAt: null } });
  const locker = new Client({ connectionString: process.env.DATABASE_URL });
  await locker.connect();
  try {
    for (const change of ["index-lock", "permission-lock"]) {
      await prisma.repository.update({ where: { id: repo.id }, data: { organizationId: source.id, provider: "github", indexStatus: "pending", indexAttemptId: null } });
      await prisma.organizationMember.updateMany({ where: { organizationId: source.id, userId }, data: { role: "owner", scopes: [], deletedAt: null } });
      await prisma.organizationMember.updateMany({ where: { organizationId: target.id, userId }, data: { deletedAt: null } });
      notifications = 0;
      afterAdmission = async () => {
        await locker.query("BEGIN");
        if (change === "index-lock") await locker.query('UPDATE repositories SET "indexStatus" = $1, "indexAttemptId" = $2 WHERE id = $3', ["indexing", "locked-attempt", repo.id]);
        else await locker.query('UPDATE organization_members SET role = $1 WHERE "organizationId" = $2 AND "userId" = $3', ["member", source.id, userId]);
      };
      const transfer = transferRepository(repo.id, target.id);
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const rows = await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
        if (rows[0].n > 0) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.ok(waiting, `${change} must block the transfer until the competing update commits`);
      await locker.query("COMMIT");
      assert.ok((await transfer).error, `${change} must be rechecked after the lock`);
      assert.equal((await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } })).organizationId, source.id);
      assert.equal(notifications, 0);
    }
  } finally { await locker.query("ROLLBACK").catch(() => {}); await locker.end(); }
  await prisma.organizationMember.updateMany({ where: { organizationId: target.id, userId }, data: { deletedAt: null } });
  for (const permission of [{ role: "owner", scopes: [] }, { role: "admin", scopes: [] }, { role: "member", scopes: ["repos:manage"] }]) {
    await prisma.organizationMember.updateMany({ where: { organizationId: source.id, userId }, data: { ...permission, deletedAt: null } });
    await prisma.repository.update({ where: { id: repo.id }, data: { organizationId: source.id, provider: "github", indexStatus: "pending", indexAttemptId: null } });
    notifications = 0;
    assert.deepEqual(await transferRepository(repo.id, target.id), { success: true });
    assert.equal((await prisma.repository.findUniqueOrThrow({ where: { id: repo.id } })).organizationId, target.id);
    assert.equal(notifications, 2);
  }
} finally {
  await prisma.organization.deleteMany({ where: { id: { in: [source.id, target.id, other.id] } } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
}
