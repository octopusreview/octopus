import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

for (const status of [403, 429]) {
  it.skipIf(process.env.RUN_INDEX_RATE_QDRANT_TESTS !== "1")(`recovers a synthetic index into Qdrant after HTTP ${status}`, async () => {
    const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/github-index-qdrant-recovery-db.ts", import.meta.url)), String(status)], {
      cwd: process.cwd(), stdout: "pipe", stderr: "pipe", env: process.env,
    });
    const watchdog = setTimeout(() => child.kill("SIGKILL"), 30000);
    try {
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exit, `${stdout}\n${stderr}`).toBe(0);
    } finally { clearTimeout(watchdog); }
  }, 35000);
}
