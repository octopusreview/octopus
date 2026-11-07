import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

describe("Qdrant collection lookup cancellation", () => {
  it("passes cancellation from the full indexer", async () => {
    const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/index-qdrant-lookup-cancellation.ts", import.meta.url))], { stdout: "pipe", stderr: "pipe", env: process.env });
    const watchdog = setTimeout(() => child.kill(), 10_000);
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    clearTimeout(watchdog);
    expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: "", stderr: "" });
  });

  it("does not cancel another lookup using the shared client", async () => {
    const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/qdrant-lookup-concurrent.ts", import.meta.url))], { stdout: "pipe", stderr: "pipe", env: process.env });
    const watchdog = setTimeout(() => child.kill(), 10_000);
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    clearTimeout(watchdog);
    expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: "", stderr: "" });
  });

  for (const scenario of ["pre-aborted", "existing-cancel", "missing-cancel", "error-cancel", "error", "error-signal", "body-cancel", "timeout", "timeout-body", "existing-success", "missing-success", "existing-signal-success", "missing-signal-success"]) {
    it(scenario, async () => {
      const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/qdrant-lookup-cancellation.ts", import.meta.url)), scenario], {
        stdout: "pipe", stderr: "pipe", env: process.env,
      });
      const watchdog = setTimeout(() => child.kill(), 10_000);
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      clearTimeout(watchdog);
      expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: "", stderr: "" });
    });
  }
});
