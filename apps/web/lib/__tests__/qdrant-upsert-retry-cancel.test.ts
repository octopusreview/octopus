import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

describe("Qdrant upsert retry cancellation", () => {
  for (const scenario of ["during-request", "during-backoff", "after-success", "sparse-abort", "sparse-retry-cancel", "sparse-success", "normal-retry", "signal-retry", "normal-error", "pre-aborted"]) {
    it(scenario, async () => {
      const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/qdrant-upsert-retry-cancel.ts", import.meta.url)), scenario], { stdout: "pipe", stderr: "pipe", env: process.env });
      const watchdog = setTimeout(() => child.kill(), 10_000);
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      clearTimeout(watchdog);
      expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: "", stderr: "" });
    });
  }
});
