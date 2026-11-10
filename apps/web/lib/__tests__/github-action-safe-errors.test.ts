import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

describe("GitHub Action review error privacy", () => {
  for (const scenario of ["authenticated", "community", "wrapped", "persistence", "conflict", "audit", "success", "denied"]) {
    it(scenario, async () => {
      const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/github-action-safe-errors.ts", import.meta.url)), scenario], {
        cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(code, `${stdout}\n${stderr}`).toBe(0);
    });
  }
});
