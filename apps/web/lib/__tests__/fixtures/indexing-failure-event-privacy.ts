import { mock } from 'bun:test';
import assert from 'node:assert/strict';
const marker = 'synthetic-marker-not-a-credential';
const events: unknown[] = [];
const errors: unknown[][] = [];
mock.module('server-only', () => ({}));
mock.module('@/lib/repository-index-completion', () => ({ runRepositoryIndex: async () => { throw new Error(marker); }, SupersededIndexError: class extends Error {}, isIndexingCancelled: () => false }));
mock.module('@/lib/background-failure', () => ({ reportBackgroundFailure: () => {} }));
mock.module('@octopus/db', () => ({ prisma: {} }));
mock.module('@/lib/repository-index-notifications', () => ({ notifyRepositoryIndex: async () => {} }));
mock.module('@/lib/indexing-abort', () => ({ clearAbortController: () => {} }));
mock.module('@/lib/events', () => ({ eventBus: { emit: (event: unknown) => events.push(event) } }));
const original = console.error;
console.error = (...args: unknown[]) => { errors.push(args); };
try {
  const { runIndexingInBackground } = await import('@/lib/indexing-runner');
  await runIndexingInBackground('repo','fixture/repo','main','org',1,'channel',() => {},new AbortController(),'attempt');
  assert.equal(events.length, 1);
  const event = events[0] as { type: string; success: boolean };
  assert.equal(event.type, 'repo-indexed');
  assert.equal(JSON.stringify(events[0]).includes(marker), false);
  assert.equal(event.success, false);
  assert.equal(JSON.stringify(errors).includes(marker), false);
} finally { console.error = original; }
