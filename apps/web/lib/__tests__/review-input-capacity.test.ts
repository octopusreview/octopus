import { expect, it } from "bun:test";

it("validates the default input capacity independently of operator overrides", async () => {
  const child = Bun.spawn(["bun", "test", "./lib/__tests__/fixtures/review-input-capacity-harness.ts"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
    env: { ...process.env, MAX_DIFF_CHARS: undefined },
  });
  const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()]);
  expect({ exit, errors: exit ? stderr : "" }).toEqual({ exit: 0, errors: "" });
});
