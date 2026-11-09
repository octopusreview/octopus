import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

it("uses the indexing transport for metadata and file requests including retries", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/github-index-request-injection.ts", import.meta.url))], {
    cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
  });
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, `${stdout}\n${stderr}`).toBe(0);
  } finally { clearTimeout(watchdog); }
}, 15_000);
