import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

it("sanitizes authorized admin broadcasts and notification failures", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/indexing-admin-privacy-harness.ts", import.meta.url))], { cwd: fileURLToPath(new URL("../../", import.meta.url)), stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
