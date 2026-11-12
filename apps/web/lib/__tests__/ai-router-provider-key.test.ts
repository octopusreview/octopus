import { expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

it("selects only the active provider key and preserves route ownership", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/ai-router-provider-key.ts", import.meta.url))], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)), stdout: "pipe", stderr: "pipe",
  });
  const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
});
