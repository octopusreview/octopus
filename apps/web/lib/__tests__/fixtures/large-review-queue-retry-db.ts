import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve(import.meta.dir, '../../../../..');
const req = createRequire(root + '/apps/web/package.json');
const { PgBoss } = req('pg-boss');
const { Client } = req('pg');
const lib = root + '/apps/web/lib/';
const safe = process.env.DATABASE_URL;
const parsed = new URL(safe ?? 'http://invalid');
assert.ok(['postgres:', 'postgresql:'].includes(parsed.protocol));
assert.equal(parsed.hostname, '127.0.0.1');
assert.match(parsed.pathname, /(?:^|[-_])test$/);
assert.equal(parsed.search + parsed.hash, '');
const secret = 'synthetic-result-error-secret';
let calls = 0;
mock.module(lib + 'large-review-result.ts', () => ({ handleLargeReviewResult: async () => { if (++calls === 1) throw Object.assign(new Error(secret), { status: 503 }); } }));
for (const [file, names] of Object.entries({
 'background-failure':['reportBackgroundFailure'], 'forgejo-connector':['cleanupForgejoConnectorRequests'], 'emails/welcome':['sendWelcomeEmail'],
 reviewer:['processReview'], 'review-capacity':['createReviewExecutionWindow','isReviewCancelled'], 'community-review':['processCommunityReview'],
 audit:['enforceAuditLogRetention','enforceActivityEventRetention'], 'webhook-tenant':['enforceWebhookDeliveryRetention'],
 releases:['refreshReleaseCache'], subscription:['renewDueSubscriptions'], credits:['reconcileAutoReloadAttempts'],
 'marketing-outbox':['syncMarketingConversions'], 'ollama-admin':['runOllamaPull'], 'reap-stuck-reviews':['reapStuckReviews'],
 'discover-repositories':['discoverRepositories'], 'repository-index-job':['processRepositoryIndex'],
})) mock.module(lib + file + '.ts', () => Object.fromEntries(names.map(name => [name, () => { throw new Error('Unexpected synthetic test path'); }])));
const { registerWorkers } = await import(lib + 'queue-workers.ts');
const handlers = new Map<string, (jobs: unknown[]) => Promise<void>>();
const originalLog = console.log, originalError = console.error;
let captured = '';
console.log = (...args: unknown[]) => { captured += JSON.stringify(args); };
console.error = (...args: unknown[]) => { captured += JSON.stringify(args); };
const schema = 'oct_test_' + randomUUID().replaceAll('-', '');
const boss = new PgBoss({ connectionString: safe, schema });
const client = new Client({ connectionString: safe });
try {
 await registerWorkers({ work: async (name: string, ...args: unknown[]) => { handlers.set(name, args.at(-1) as never); } } as never, { reviewConcurrency: 1 } as never);
 await client.connect();
 await boss.start();
 const name='post-large-review-result';
 await boss.createQueue(name, { retryLimit: 1, retryDelay: 3, retryBackoff: false });
 await boss.work(name, { pollingIntervalSeconds: 0.5 }, handlers.get(name)!);
 const id = await boss.send(name, { pullRequestId: 'synthetic-pr' });
 assert.ok(id);
 let sawRetry = false, completed = false;
 const deadline = Date.now() + 16000;
 while (Date.now() < deadline) {
  const {rows} = await client.query(`SELECT state::text, retry_count, output FROM "${schema}".job WHERE id=$1`, [id]);
  const row = rows[0];
  if (row?.state === 'retry') {
   sawRetry = true;
   assert.equal(row.retry_count, 0);
   assert.ok(JSON.stringify(row.output).includes('Large review result delivery failed'));
   assert.ok(!JSON.stringify(row.output).includes(secret));
  }
  if (row?.state === 'completed') { completed = true; break; }
  await new Promise(resolve => setTimeout(resolve, 100));
 }
 assert.ok(sawRetry, 'retry state was persisted');
 assert.ok(completed, 'retried job completed');
 assert.equal(calls, 2);
 assert.ok(!captured.includes(secret));
} finally {
 await boss.stop({ graceful: true, timeout: 5000 }).catch(() => {});
 await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
 await client.end().catch(() => {});
 console.log = originalLog; console.error = originalError;
}
console.log('PASS actual queue retry and persisted failure output stay private');
