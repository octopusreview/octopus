import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

describe("GitHub blob response lifetime", () => {
  for (const scenario of ["cancel", "timeout", "retry-timeout", "success"]) {
    it(scenario, async () => {
      const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/index-blob-body-synthetic.ts", import.meta.url)), scenario], {
        cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(code, `${stdout}\n${stderr}`).toBe(0);
    }, 10_000);
  }
});
