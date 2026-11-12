import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

describe("embedding batches and cancellation", () => {
  for (const scenario of ["openai-batch", "openai-split-cancel", "openai-split-success", "ollama-batch", "tracked-over-limit", "tracked-signal-refused", "pre-aborted"]) {
    it(scenario, async () => {
      const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/embedding-batch-abort.ts", import.meta.url)), scenario], {
        cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
      });
      const deadline = setTimeout(() => child.kill("SIGKILL"), 5_000);
      try {
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(code, `${stdout}\n${stderr}`).toBe(0);
      } finally { clearTimeout(deadline); }
    }, 10_000);
  }
});
