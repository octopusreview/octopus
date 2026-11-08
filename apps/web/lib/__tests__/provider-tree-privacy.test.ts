import { expect, it } from "bun:test";

it("keeps provider tree failures private while preserving fallback", async () => {
  const child = Bun.spawn([process.execPath, "lib/__tests__/fixtures/provider-tree-privacy.ts"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});
