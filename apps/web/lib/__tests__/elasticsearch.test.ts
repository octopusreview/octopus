import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

it("returns the latest tenant-scoped sync logs in chronological order", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/elasticsearch-harness.ts", import.meta.url))], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});
