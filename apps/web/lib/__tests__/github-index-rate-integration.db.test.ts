import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

it.skipIf(process.env.RUN_INDEX_RATE_DB_TESTS !== "1")("defers real indexing until the shared GitHub limit can recover", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/github-index-rate-integration-db.ts", import.meta.url))], {
    cwd: process.cwd(), stdout: "pipe", stderr: "pipe", env: process.env,
  });
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 20_000);
  try {
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, `${stdout}\n${stderr}`).toBe(0);
  } finally { clearTimeout(watchdog); }
}, 25_000);
