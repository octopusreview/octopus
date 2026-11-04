import { expect, it } from "bun:test";

it("requests a fresh sign-in without masking other session errors", async () => {
  const child = Bun.spawn([process.execPath, "lib/__tests__/fixtures/sessions-freshness-harness.tsx"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});
