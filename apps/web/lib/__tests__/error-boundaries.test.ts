import { expect, it } from "bun:test";

it("error boundaries retry the route, announce themselves and report client errors once", async () => {
  const child = Bun.spawn(["bun", "lib/__tests__/fixtures/error-boundaries-harness.tsx"], {
    cwd: import.meta.dir + "/../..", stdout: "pipe", stderr: "pipe",
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
  expect(stdout).toContain("PASS error boundaries retry");
});
