import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

const enabled = process.env.RUN_FIRST_INDEX_DB_TESTS === "1";
const cases = [
  "first", "reindex", "legacy", "concurrent-earlier-first", "concurrent-later-first",
  "migration", "failed", "cancelled", "background", "late-cancel", "empty", "superseded", "replacement", "empty-then-content", "failed-reindex",
  "local-single", "local-verified", "local-legacy", "local-nonfinal", "local-gap", "local-duplicate", "local-wrong-session", "local-cancel",
  "actions", "community", "empty-incremental-full", "legacy-incremental",
  "local-count-under", "local-count-over", "background-replacement", "background-setup-failure",
  "background-notification-failure", "background-unconfigured",
  "storage-provider", "storage-local", "storage-reset", "storage-incremental",
  "storage-late-upsert", "storage-late-delete", "storage-local-timeout", "storage-reads", "storage-legacy-rollout",
  "storage-concurrent-incremental", "storage-incremental-cleanup", "storage-renamed-branch", "storage-local-verified", "storage-local-legacy",
  "timezone-utc", "timezone-berlin",
] as const;

(enabled ? describe : describe.skip)("repository index completion with PostgreSQL", () => {
  for (const scenario of cases) {
    it(scenario, async () => {
      const child = Bun.spawn([
        process.execPath,
        fileURLToPath(new URL("./fixtures/repository-index-completion-harness.ts", import.meta.url)),
        scenario,
      ], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
      const [code, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
      ]);
      expect(code, `${stdout}\n${stderr}`).toBe(0);
    }, 30_000);
  }
});
