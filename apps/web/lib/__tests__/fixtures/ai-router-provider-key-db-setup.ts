import { mock } from "bun:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
assert.match(url.pathname, /^\/[a-zA-Z0-9_-]+$/);
assert.match(url.pathname, /(^|[-_])test($|[-_])/);
assert.equal(url.search, "");
assert.equal(url.hash, "");
mock.module("server-only", () => ({}));
const { prisma } = await import("@octopus/db");
const suffix = randomBytes(8).toString("hex");
const role = `octopus_key_select_test_${suffix}`;
const password = randomBytes(24).toString("hex");
const orgA = `fixture_${suffix}_a`;
const orgB = `fixture_${suffix}_b`;
let roleCreated = false;
try {
  await prisma.$executeRawUnsafe(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`);
  roleCreated = true;
  await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
  await prisma.$executeRawUnsafe(`GRANT SELECT (id, "openaiApiKey") ON TABLE organizations TO "${role}"`);
  await prisma.organization.create({ data: { id: orgA, name: "Fixture A", slug: orgA, openaiApiKey: "fake:openai", anthropicApiKey: "fake:other-provider" } });
  await prisma.organization.create({ data: { id: orgB, name: "Fixture B", slug: orgB, openaiApiKey: "fake:other", anthropicApiKey: "fake:other-provider" } });
  url.username = role;
  url.password = password;
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./ai-router-provider-key-db.ts", import.meta.url))], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url.toString(), TASK_SYNTHETIC_ORG_A: orgA, TASK_SYNTHETIC_ORG_B: orgB },
    stdout: "pipe", stderr: "pipe",
  });
  const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  assert.equal(exit, 0, stderr);
} finally {
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  if (roleCreated) {
    await prisma.$executeRawUnsafe(`DROP OWNED BY "${role}"`);
    await prisma.$executeRawUnsafe(`DROP ROLE "${role}"`);
  }
  await prisma.$disconnect();
}
