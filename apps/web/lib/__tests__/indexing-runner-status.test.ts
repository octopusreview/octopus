import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

it("emits safe fixed indexing statuses without changing outcomes", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/indexing-runner-status-harness.ts", import.meta.url))], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
