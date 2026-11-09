import { mock } from "bun:test";
import assert from "node:assert/strict";

const db = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["postgres:", "postgresql:"].includes(db.protocol));
assert.ok(["localhost", "127.0.0.1"].includes(db.hostname));
assert.match(db.pathname.slice(1), /(^|[-_])test($|[-_])/);
assert.equal(db.search + db.hash, "");
mock.module("server-only", () => ({}));
const { prisma } = await import("@octopus/db");
const { githubIndexRateScope } = await import("../../github-index-rate-scope");

process.env.BETTER_AUTH_SECRET = "synthetic-legacy-key";
delete process.env.OCTOPUS_DATA_KEY;
const token = "synthetic-private-token";
try {
  await prisma.$executeRaw`DELETE FROM "github_index_rate_secret"`;
  const scopes = await Promise.all(Array.from({ length: 20 }, () => githubIndexRateScope({ installationId: 0, providedToken: token })));
  assert.equal(new Set(scopes).size, 1, "concurrent workers choose one scope");
  assert.ok(!scopes[0].includes(token));
  assert.equal(await githubIndexRateScope({ installationId: 7, providedToken: token }), scopes[0]);
  assert.notEqual(await githubIndexRateScope({ installationId: 0, providedToken: "synthetic-other-token" }), scopes[0]);
  assert.equal(await githubIndexRateScope({ installationId: 42 }), "github-index-installation:42");
  assert.notEqual(await githubIndexRateScope({ installationId: 43 }), "github-index-installation:42");
  await assert.rejects(githubIndexRateScope({ installationId: 0 }), /scope/i);
  await assert.rejects(githubIndexRateScope({ installationId: 0, providedToken: "" }), /scope/i);
  const rows = await prisma.$queryRaw<Array<{ secretEnc: string }>>`SELECT "secretEnc" FROM "github_index_rate_secret"`;
  assert.equal(rows.length, 1);
  assert.ok(!rows[0].secretEnc.includes(token));
  process.env.OCTOPUS_DATA_KEY = "1".repeat(64);
  const migrated = await Promise.all(Array.from({ length: 20 }, () => githubIndexRateScope({ installationId: 0, providedToken: token })));
  assert.ok(migrated.every(scope => scope === scopes[0]), "data-key migration preserves the scope across workers");
  process.env.BETTER_AUTH_SECRET = "synthetic-rotated-auth-key";
  assert.equal(await githubIndexRateScope({ installationId: 0, providedToken: token }), scopes[0], "the legacy auth key can be rotated after migration");
} finally {
  await prisma.$executeRaw`DELETE FROM "github_index_rate_secret"`;
  await prisma.$disconnect();
}
