import { expect, it } from "bun:test";

it("reports safe terminal background failures through the provider router", async () => {
  const child = Bun.spawn([process.execPath, "lib/__tests__/fixtures/background-failure-harness.ts"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});

it("forwards queue retries and reports only terminal uncancelled failures", async () => {
  const child = Bun.spawn([process.execPath, "lib/__tests__/fixtures/queue-background-failure-harness.ts"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});

it("identifies failed preparation fetches through the reviewer", async () => {
  const child = Bun.spawn([process.execPath, "lib/__tests__/fixtures/review-follow-up-harness.ts", "--preparation-diagnostic"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, `${stdout}\n${stderr}`).toBe(0);
});
