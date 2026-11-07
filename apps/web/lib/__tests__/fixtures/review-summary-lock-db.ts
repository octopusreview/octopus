import { mock } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const scenario = process.argv[2];
assert.ok(["lock-success", "superseded", "cancelled", "deadline"].includes(scenario));
const db = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["postgres:", "postgresql:"].includes(db.protocol));
assert.ok(["localhost", "127.0.0.1"].includes(db.hostname));
assert.match(db.pathname.slice(1), /^[a-z0-9_-]+$/i);
assert.match(db.pathname.slice(1), /(^|[-_])test($|[-_])/);
assert.equal(db.search + db.hash, "");
db.hostname = "127.0.0.1";
process.env.DATABASE_URL = db.toString();
mock.module("server-only", () => ({}));
let posts = 0;
let updates = 0;
let updateAborted = false;
mock.module("@/lib/github", () => ({
  getInstallationToken: async () => "synthetic-token",
  createPullRequestComment: async () => { posts++; return 123; },
  updatePullRequestComment: async (_a: number, _b: string, _c: string, _d: number, _e: string, _f: string, signal: AbortSignal) => {
    updates++;
    await new Promise<void>((_resolve, reject) => {
      const abort = () => { updateAborted = true; reject(signal.reason); };
      if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    });
  },
  findPullRequestSummaryComment: async () => null,
}));
const { prisma } = await import("@octopus/db");
const { publishReviewSummary } = await import("@/lib/review-summary-comment");
const locker = new Client({ connectionString: process.env.DATABASE_URL });
await locker.connect();
const org = await prisma.organization.create({ data: { name: "Synthetic", slug: `summary-lock-${randomUUID()}` } });
try {
  const repo = await prisma.repository.create({ data: { organizationId: org.id, name: "Synthetic", fullName: "synthetic/repo", externalId: randomUUID() } });
  const pr = await prisma.pullRequest.create({ data: { repositoryId: repo.id, number: 1, title: "Synthetic", url: "https://example.invalid", author: "synthetic", headSha: "a".repeat(40), status: "reviewing", ...(scenario === "deadline" ? { reviewCommentId: 123n } : {}) } });
  await locker.query("BEGIN");
  await locker.query("SELECT id FROM pull_requests WHERE id = $1 FOR UPDATE", [pr.id]);
  if (scenario === "superseded") await locker.query('UPDATE pull_requests SET "headSha" = $1 WHERE id = $2', ["b".repeat(40), pr.id]);
  const waitMs = scenario === "deadline" ? 18_000 : scenario === "lock-success" ? 12_000 : 1_000;
  const unlock = setTimeout(() => { void locker.query("COMMIT"); }, waitMs);
  const controller = new AbortController();
  const cancel = scenario === "cancelled" ? setTimeout(() => controller.abort(), 250) : undefined;
  const executionWindow = scenario === "cancelled" ? { jobId: "synthetic", deadlineEpochMs: Date.now() + 60_000, signal: controller.signal, remainingMs: () => 60_000 } : undefined;
  try {
    const result = await publishReviewSummary({ pullRequestId: pr.id, headSha: pr.headSha, reviewRequestVersion: pr.reviewRequestVersion,
      installationId: 123, owner: "synthetic", repo: "repo", prNumber: 1, body: "synthetic progress", executionWindow });
    if (scenario === "lock-success") { assert.equal(result, 123); assert.equal(posts, 1); }
    else { assert.equal(scenario, "superseded"); assert.equal(result, null); assert.equal(posts + updates, 0); }
  } catch (error) {
    if (scenario === "lock-success" || scenario === "superseded") throw error;
    if (scenario === "cancelled") { assert.equal(posts + updates, 0); assert.equal((error as Error).name, "ReviewProcessingExpiredError"); }
    else { assert.equal((error as Error).name, "TimeoutError"); assert.equal(posts, 0); assert.equal(updates, 1); assert.equal(updateAborted, true); }
  } finally { clearTimeout(unlock); if (cancel) clearTimeout(cancel); }
} finally {
  await locker.query("ROLLBACK").catch(() => {});
  await locker.end();
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.$disconnect();
}
