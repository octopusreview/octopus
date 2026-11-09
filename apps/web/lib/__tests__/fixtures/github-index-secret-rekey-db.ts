import { mock } from "bun:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const db = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["postgres:", "postgresql:"].includes(db.protocol));
assert.ok(["localhost", "127.0.0.1"].includes(db.hostname));
assert.match(db.pathname.slice(1), /(^|[-_])test($|[-_])/);
assert.equal(db.search + db.hash, "");
mock.module("server-only", () => ({}));
const { prisma } = await import("@octopus/db");
const { githubIndexRateScope } = await import("../../github-index-rate-scope");
const oldKey = "1".repeat(64), newKey = "2".repeat(64), wrongKey = "3".repeat(64), token = "synthetic-private-token";
process.env.OCTOPUS_DATA_KEY = oldKey;
process.env.BETTER_AUTH_SECRET = "synthetic-legacy-secret";
const script = fileURLToPath(new URL("../../../scripts/rekey-github-index-secret.ts", import.meta.url));
const run = async (previous: string, apply: boolean) => {
  const child = Bun.spawn([process.execPath, script, ...(apply ? ["--apply"] : [])], {
    cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
    env: { ...process.env, OCTOPUS_DATA_KEY: newKey, OCTOPUS_PREVIOUS_DATA_KEY: previous },
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  for (const secret of [oldKey, newKey, wrongKey, token]) assert.ok(!(stdout + stderr).includes(secret), "rekey output contains no secret");
  return exit;
};
const ciphertext = async () => (await prisma.$queryRaw<Array<{ secretEnc: string }>>`SELECT "secretEnc" FROM "github_index_rate_secret"`)[0]?.secretEnc;
try {
  await prisma.$executeRaw`DELETE FROM "github_index_rate_secret"`;
  const scope = await githubIndexRateScope({ installationId: 0, providedToken: token });
  const before = await ciphertext();
  assert.equal(await run(oldKey, false), 0);
  assert.equal(await ciphertext(), before, "dry-run does not write");
  assert.equal(await run(wrongKey, true), 1);
  assert.equal(await ciphertext(), before, "wrong prior key cannot change the secret");
  assert.equal(await run(oldKey, true), 0);
  const after = await ciphertext();
  assert.notEqual(after, before);
  process.env.OCTOPUS_DATA_KEY = newKey;
  assert.equal(await githubIndexRateScope({ installationId: 0, providedToken: token }), scope);
  assert.equal(await run(oldKey, true), 0, "repeating after an uncertain result is safe");
  assert.equal(await ciphertext(), after, "an already-current secret is not rewritten");
} finally {
  await prisma.$executeRaw`DELETE FROM "github_index_rate_secret"`;
  await prisma.$disconnect();
}
