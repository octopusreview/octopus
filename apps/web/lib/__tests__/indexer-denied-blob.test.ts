import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

describe("GitHub indexing after a denied blob retry", () => {
  for (const scenario of ["denied-403", "denied-429", "mixed-denial", "recovered", "normal", "other-error", "retry-server-error", "completion-denied", "abort", "slow-sibling"]) {
    it(scenario, async () => {
      const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/indexer-denied-blob.ts", import.meta.url)), scenario], {
        cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
      });
      const deadline = setTimeout(() => child.kill("SIGKILL"), 10_000);
      try {
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(code, `${stdout}\n${stderr}`).toBe(0);
      } finally { clearTimeout(deadline); }
    }, 15_000);
  }
});
