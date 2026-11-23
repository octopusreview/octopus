import { expect, it } from "bun:test";
import { resolve } from "node:path";

it("summarizing without an organization uses the platform fallback model", () => {
  const result = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "fixtures/summarizer-default-model-harness.ts")], {
    cwd: resolve(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe",
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  expect(result.stdout.toString()).toContain("summarizer default model checks passed");
});
