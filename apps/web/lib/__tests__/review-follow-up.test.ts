import { expect, it } from "bun:test";

it("records an Anthropic refusal as an incomplete failed review", async () => {
  const child = Bun.spawn(["bun", "lib/__tests__/fixtures/review-follow-up-harness.ts", "--provider-refusal"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
  expect(stdout).toContain("PASS refusal remains an incomplete failed review");
});

it("handles direct Forgejo comment failure without connector uncertainty", async () => {
  const child = Bun.spawn(["bun", "lib/__tests__/fixtures/review-follow-up-harness.ts", "--direct-forgejo-comment-failure"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
  expect(stdout).toContain("PASS handled direct Forgejo comment failure without connector uncertainty");
});

it("fully assesses unfinished retries through the hosted reviewer", async () => {
  const child = Bun.spawn(["bun", "lib/__tests__/fixtures/review-follow-up-harness.ts"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
  expect(stdout).toContain("PASS incomplete retry findings, inline publication and assessment gates");
});
