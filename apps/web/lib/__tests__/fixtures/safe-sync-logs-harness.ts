import { mock } from "bun:test";
import assert from "node:assert/strict";

mock.module("server-only", () => ({}));
mock.module("@octopus/db", () => ({ prisma: {} }));
const { safeSyncLogs } = await import("@/lib/repository-index-completion");
const safe = ["Processed 5 files, skipped 0", "Processing files... 3/10", "Processing embedding batch 2/5...", "Repository cloned successfully", "Generating embeddings for 5 chunks (1 batch)...", "Storing 5 vectors in database (2 batches)..."];
const unsafe = ["synthetic-secret", "/private/synthetic/file.ts", "Processed 5 files, skipped 0 synthetic-secret", "Processed 5 files, skipped 0\n", "Indexing failed: synthetic-secret"];
for (const attempt of [undefined, "current"]) {
  const logs = [...safe, ...unsafe].map(message => ({ orgId: "org", repoId: "repo", indexAttemptId: attempt, message, level: "info" as const, timestamp: 42, extra: "synthetic-secret" }));
  assert.deepEqual(safeSyncLogs(logs, "org", "repo", attempt), [...safe, ...unsafe.map(() => "Saved indexing message withheld for privacy.")].map(message => ({
    orgId: "org", repoId: "repo", ...(attempt ? { indexAttemptId: attempt } : {}), message, level: "info", timestamp: 42,
  })));
}
