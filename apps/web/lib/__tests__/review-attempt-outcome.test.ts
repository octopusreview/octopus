import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

const scenarios = [
  "policy-mixed-covered", "policy-all-excluded", "policy-unavailable-assessed", "policy-unavailable-incomplete",
  "policy-omitted-assessed", "policy-covered-incomplete", "policy-all-excluded-assessed", "policy-inventory-incomplete",
  "substantive", "zero-findings", "partial", "incomplete", "not-required", "empty", "unavailable", "large", "not-assessed",
  "completed-not-published", "uncertain-retry", "inline-fallback", "partially-published", "retry", "restart", "new-version",
  "superseded", "published-admission", "superseded-published", "last-assessment", "concurrent", "late-failure", "stale-try", "deferral",
  "retention", "recording-failure", "savepoint", "bounded-lock", "timezone-utc", "timezone-berlin", "migration",
  "main-github", "main-gitlab", "main-bitbucket", "main-forgejo", "main-rejected", "main-unknown", "main-stale", "ack-before-db-failure",
  "admission", "admission-failure", "admission-slow", "admission-transaction", "admission-rollback", "admission-source",
  "callback-throws", "callback-rejects", "claim", "rejection-classification",
  "large-stale-before-delivery", "large-stale-in-delivery", "large-stale-after-publication", "large-current",
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

(process.env.RUN_REVIEW_OUTCOME_DB_TESTS === "1" ? describe : describe.skip)("review summary publication with PostgreSQL", () => {
  for (const scenario of ["lock-success", "superseded", "cancelled", "deadline"]) {
    it(scenario, async () => {
      const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/review-summary-lock-db.ts", import.meta.url)), scenario], {
        stdout: "pipe", stderr: "pipe", env: process.env,
      });
      const watchdog = setTimeout(() => child.kill(), 26_000);
      try {
        const [exit, , stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        const reason = stderr.includes("TimeoutError") ? "TimeoutError" : stderr.includes("AssertionError") ? "AssertionError" : "child failed";
        expect({ exit, reason: exit === 0 ? "" : reason }).toEqual({ exit: 0, reason: "" });
      } finally { clearTimeout(watchdog); }
    }, 30_000);
  }
});
