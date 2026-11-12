import { expect, it } from "bun:test";

it("rejects malformed chat input before database access while preserving authorization", async () => {
  const child = Bun.spawn([process.execPath, "lib/__tests__/fixtures/chat-input-harness.ts"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});
