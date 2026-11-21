import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

it("reports a missing file as absent and every other failed read as an error", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/github-file-content-fail-on-error.ts", import.meta.url))], {
    cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
  });
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, `${stdout}\n${stderr}`).toBe(0);
  } finally { clearTimeout(watchdog); }
}, 15_000);
