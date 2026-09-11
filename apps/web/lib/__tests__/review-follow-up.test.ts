import { expect, it } from "bun:test";

it("fully assesses unfinished retries through the hosted reviewer", async () => {
  const child = Bun.spawn(["bun", "lib/__tests__/fixtures/review-follow-up-harness.ts"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
  expect(stdout).toContain("PASS incomplete retry findings, inline publication and assessment gates");
});
