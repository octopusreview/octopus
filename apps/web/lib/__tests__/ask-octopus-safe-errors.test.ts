import { expect, it } from "bun:test";
import { join } from "node:path";

it("keeps provider and storage failures out of Ask Octopus logs", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", join(import.meta.dir, "fixtures/ask-octopus-safe-errors.ts")], {
    stdout: "pipe", stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
});
