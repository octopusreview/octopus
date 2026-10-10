import { expect, it } from "bun:test";
import { resolve } from "node:path";

for (const boundary of ["api", "settings", "timeline", "knowledge", "repositories", "blog", "members"]) {
  it(`${boundary} rejects malformed input without bypassing authorization or breaking valid clients`, () => {
    const result = Bun.spawnSync([process.execPath, resolve(import.meta.dir, `fixtures/input-validation-${boundary}.ts`)], {
      cwd: resolve(import.meta.dir, "../.."),
      env: { ...process.env, BETTER_AUTH_URL: "https://octopus.example", OCTOPUS_DATA_KEY: "a".repeat(64) },
      stdout: "pipe", stderr: "pipe",
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(result.stdout.toString()).toContain("input validation checks passed");
  });
}
