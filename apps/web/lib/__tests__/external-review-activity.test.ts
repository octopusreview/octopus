import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

const sources = ["github_action", "cli_local", "cli_repo"] as const;
const common = ["generated", "caught", "config", "uncaught", "401", "403", "400", "413", "402",
  "first-failure", "second-failure", "lock", "no-dedup", "latency-normal", "latency-lock", "latency-pool"];
const scenarios = sources.flatMap(source => [
  ...common.map(test => `${source}:${test}`),
  ...(source === "cli_local" ? [] : [`${source}:404`]),
]);
scenarios.push("database", "timezone-utc", "timezone-berlin", "migration", "out-of-scope", "pool-exhaustion");

(process.env.RUN_EXTERNAL_REVIEW_DB_TESTS === "1" ? describe : describe.skip)("external review activity with PostgreSQL", () => {
  for (const scenario of scenarios) {
    it(scenario, async () => {
      const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", fileURLToPath(new URL("./fixtures/external-review-activity-preload.ts", import.meta.url)), fileURLToPath(new URL("./fixtures/external-review-activity-harness.ts", import.meta.url)), scenario], {
        cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
      ]);
      expect(code, `${stdout}\n${stderr}`).toBe(0);
      if (scenario.includes(":latency-")) console.info(stdout.trim());
    }, 30_000);
  }
});
