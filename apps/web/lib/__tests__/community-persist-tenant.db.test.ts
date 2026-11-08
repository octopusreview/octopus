import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

const run = process.env.RUN_COMMUNITY_PERSIST_DB_TESTS === "1";
for (const [name, fixture] of [
  ["serializes community review persistence with repository transfer", "community-persist-tenant-db"],
  ["preserves legacy jobs when adding repository identity", "community-job-identity-migration-db"],
  ["runs the community review worker end to end across a repository transfer", "community-review-flow-db"],
]) {
  it.skipIf(!run)(name, async () => {
    const child = Bun.spawn([process.execPath, fileURLToPath(new URL(`./fixtures/${fixture}.ts`, import.meta.url))], {
      cwd: process.cwd(), stdout: "pipe", stderr: "pipe", env: process.env,
    });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 20_000);
    try {
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(code, `${stdout}\n${stderr}`).toBe(0);
    } finally { clearTimeout(timeout); }
  }, 25_000);
}
