import { expect, it } from "bun:test";
import { join } from "node:path";

it("keeps Qdrant docs errors out of logs while preserving search", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", join(import.meta.dir, "fixtures/qdrant-docs-safe-errors.ts")], {
    stdout: "pipe", stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
});
