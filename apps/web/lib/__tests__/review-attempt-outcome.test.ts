import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

const scenarios = [
  "substantive", "zero-findings", "partial", "incomplete", "not-required", "empty", "unavailable", "large", "not-assessed",
  "completed-not-published", "uncertain-retry", "inline-fallback", "partially-published", "retry", "restart", "new-version",
  "superseded", "published-admission", "superseded-published", "last-assessment", "concurrent", "late-failure", "stale-try", "deferral",
  "retention", "recording-failure", "savepoint", "bounded-lock", "timezone-utc", "timezone-berlin", "migration",
  "main-github", "main-gitlab", "main-bitbucket", "main-forgejo", "main-rejected", "main-unknown", "main-stale", "ack-before-db-failure",
  "admission", "claim", "large-source", "rejection-classification",
] as const;

(process.env.RUN_REVIEW_OUTCOME_DB_TESTS === "1" ? describe : describe.skip)("review attempt outcomes with PostgreSQL", () => {
  for (const scenario of scenarios) {
    it(scenario, async () => {
      const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/review-attempt-outcome-harness.ts", import.meta.url)), scenario], {
        cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(code, `${stdout}\n${stderr}`).toBe(0);
    }, 30_000);
  }
});
