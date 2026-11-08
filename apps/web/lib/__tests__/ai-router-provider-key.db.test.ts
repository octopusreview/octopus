import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

describe.skipIf(process.env.RUN_PROVIDER_KEY_DB_TESTS !== "1")("provider key selection with PostgreSQL", () => {
  it("works with a role forbidden from reading other provider keys", async () => {
    const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/ai-router-provider-key-db-setup.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("../..", import.meta.url)), stdout: "pipe", stderr: "pipe",
    });
    const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
  });
});
