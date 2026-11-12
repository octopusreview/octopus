import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

it("retries one transient PR detail 500 without retrying writes or access failures", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/github-pr-details-retry-harness.ts", import.meta.url))], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});
