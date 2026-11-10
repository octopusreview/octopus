import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

it("keeps usage and vector fallback failures private", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/review-storage-safe-errors.ts", import.meta.url))], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
