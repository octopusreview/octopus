import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

it("keeps review and spend-gate fallback errors private", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/review-fallback-safe-errors.ts", import.meta.url))], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});
