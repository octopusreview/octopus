import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

for (const scenario of ["success", "cancelled", "installation-replaced", "organization-transferred"]) {
it.skipIf(process.env.RUN_INDEX_RATE_DB_TESTS !== "1")(`deferred queue recovery: ${scenario}`, async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/github-deferred-recovery-db.ts", import.meta.url)), scenario], {
    cwd: process.cwd(), stdout: "pipe", stderr: "pipe", env: process.env,
  });
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 30_000);
  try {
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, `${stdout}\n${stderr}`).toBe(0);
  } finally { clearTimeout(watchdog); }
}, 35_000);
}
