import { expect, it } from "bun:test";

it("handles direct Forgejo comment failure without connector uncertainty", async () => {
  const child = Bun.spawn(["bun", "lib/__tests__/fixtures/review-follow-up-harness.ts", "--direct-forgejo-comment-failure"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
  expect(stdout).toContain("PASS handled direct Forgejo comment failure without connector uncertainty");
});

it("approves a clean review only with the org setting on and settled earlier comments", async () => {
  const child = Bun.spawn(["bun", "lib/__tests__/fixtures/review-follow-up-harness.ts", "--approve-clean-reviews"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
  expect(stdout).toContain("PASS clean reviews approve only with the setting on and settled earlier comments");
  expect(stdout).toContain("PASS a review with nothing to assess under policy approves under the same gate");
});

it("fully assesses unfinished retries through the hosted reviewer", async () => {
  const child = Bun.spawn(["bun", "lib/__tests__/fixtures/review-follow-up-harness.ts"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
  expect(stdout).toContain("PASS incomplete retry findings, inline publication and assessment gates");
});
