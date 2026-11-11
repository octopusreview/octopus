import { mock } from "bun:test";
import assert from "node:assert/strict";

mock.module("server-only", () => ({}));
const secret = "synthetic-secret-do-not-log";
let failIndex = false;
let failSummary = false;
const notifications: string[] = [];
const reports: unknown[] = [];
const events: Array<Record<string, unknown>> = [];
const messages: Array<[string, string | undefined]> = [];
const logs: unknown[][] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => { logs.push(args); };
mock.module("@/lib/repository-index-completion", () => ({
  runRepositoryIndex: async (_repo: string, _attempt: string, work: () => Promise<unknown>) => {
    if (failIndex) throw new Error(secret);
    return work();
  },
  SupersededIndexError: class extends Error {},
  isIndexingCancelled: (signal?: AbortSignal) => !!signal?.aborted,
}));
mock.module("@/lib/indexer", () => ({ indexRepository: async () => ({ indexedFiles: 2, totalVectors: 3, durationMs: 5 }) }));
mock.module("@/lib/summarizer", () => ({ summarizeRepository: async () => { if (failSummary) throw new Error(secret); return { summary: "ok", purpose: "ok" }; } }));
mock.module("@/lib/background-failure", () => ({ reportBackgroundFailure: (error: unknown) => { reports.push(error); } }));
mock.module("@/lib/repository-index-notifications", () => ({ notifyRepositoryIndex: async () => { notifications.push("status"); } }));
mock.module("@/lib/indexing-abort", () => ({ clearAbortController: () => {} }));
mock.module("@/lib/events", () => ({ eventBus: { emit: (event: Record<string, unknown>) => { events.push(event); } } }));
mock.module("@octopus/db", () => ({ prisma: { repository: {
  updateMany: async () => ({ count: 1 }), findUnique: async () => ({ indexAttemptId: "attempt", indexStatus: "indexed" }),
} } }));
const { runIndexingInBackground } = await import("@/lib/indexing-runner");
const run = (controller = new AbortController()) => runIndexingInBackground("repo", "fixture/repo", "main", "org", 1, "presence-org-org", (message, level) => { messages.push([message, level]); }, controller, "attempt");
try {
  failSummary = true;
  await run();
  assert.ok(logs.some(args => args[0] === "Failed to generate summary"));
  assert.ok(events.some(event => event.type === "repo-indexed" && event.success === true));
  assert.ok(messages.some(([message]) => message === "Starting indexing"));
  assert.ok(messages.some(([message, level]) => message === "Indexing complete" && level === "success"));
  assert.ok(messages.some(([message, level]) => message === "Summary generation failed (indexing still succeeded)" && level === "warning"));
  failIndex = true;
  await run();
  assert.ok(logs.some(args => args[0] === "Failed to index repository"));
  assert.ok(events.some(event => event.type === "repo-indexed" && event.success === false && event.error === "Indexing failed"));
  assert.equal(reports.length, 1);
  const before = events.length;
  const cancelled = new AbortController();
  cancelled.abort();
  await run(cancelled);
  assert.equal(events.length, before);
  assert.equal(reports.length, 1);
  assert.ok(messages.some(([message]) => message === "Indexing cancelled by user"));
  assert.ok(notifications.length >= 3);
  assert.ok(!logs.flat().map(String).join(" ").includes(secret));
  assert.ok(!JSON.stringify({ events, messages }).includes(secret));
} finally { console.error = originalError; }
