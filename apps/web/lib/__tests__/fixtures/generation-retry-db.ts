import { mock } from "bun:test";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import type { ReviewCoverage } from "../../review-coverage";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
assert.match(url.pathname, /(^|[-_])test($|[-_])/);
assert.equal(url.search, "");
assert.equal(url.hash, "");
url.hostname = "127.0.0.1";
process.env.DATABASE_URL = url.toString();
mock.module("server-only", () => ({}));
mock.module("@/lib/stripe", () => ({ getStripe: () => { throw new Error("Stripe must not be called"); }, getOffSessionPaymentMethodId: async () => null }));
mock.module("@/lib/events/bus", () => ({ eventBus: { emit: () => {}, on: () => {}, off: () => {} } }));
// One synthetic dollar per charged call keeps the ledger arithmetic exact.
mock.module("@/lib/cost", () => ({ getModelPricing: async () => ({}), calcCost: () => 1 }));
const { prisma } = await import("@octopus/db");
const { claimGenerationAttempt, startReviewOutcome, GENERATION_ATTEMPT_BUDGET } = await import("../../review-attempt-outcome");
const { executeCoveredReview } = await import("../../review-assessment");
const { AiProviderFailure } = await import("../../provider-failure");
const { logAiUsage } = await import("../../ai-usage");
const id = randomUUID();
const org = await prisma.organization.create({ data: { name: "Synthetic", slug: `generation-retry-test-${id}`, creditBalance: 100 } });
const log = console.log, error = console.error;
console.log = console.error = () => {};
try {
  const repo = await prisma.repository.create({ data: { organizationId: org.id, name: "Synthetic", fullName: "fixture/repo", externalId: id } });
  const pr = await prisma.pullRequest.create({ data: { repositoryId: repo.id, number: 1, title: "Synthetic", url: "", author: "fixture", status: "reviewing", reviewRequestVersion: 1 } });
  const key = (requestVersion: number) => ({ organizationId: org.id, repositoryId: repo.id, pullRequestId: pr.id, requestVersion });
  const attempts = async (requestVersion: number) => (await prisma.reviewAttemptOutcome.findUniqueOrThrow({ where: { pullRequestId_requestVersion: { pullRequestId: pr.id, requestVersion } } })).generationAttempts;

  // One job: a transient failure, the admitted retry, then a redelivery of the same request version.
  let dispatches = 0;
  const window = { jobId: "fixture", deadlineEpochMs: Date.now() + 900000, signal: new AbortController().signal, remainingMs: () => 900000 };
  const job = async () => {
    if (!await claimGenerationAttempt(key(1))) return "refused";
    const coverage: ReviewCoverage = { version: 1, provider: "github", headSha: "a".repeat(40), baseSha: "b".repeat(40), reviewRequestVersion: 1,
      inventoryComplete: true, expectedFiles: 0, complete: true, limitations: [], files: [] };
    try {
      await executeCoveredReview({ model: "gpt-fixture", maxTokens: 16, maxRetries: 0, messages: [{ role: "user", content: "fixture" }] }, coverage, "fixture",
        async () => { dispatches++; throw new AiProviderFailure(new Error("terminated"), "openai", "gpt-fixture", "platform"); },
        { window, confirm: () => claimGenerationAttempt(key(1)) });
    } catch { return `failed after ${coverage.assessment?.attempts?.length ?? 0} earlier attempt`; }
    return "completed";
  };
  await startReviewOutcome(key(1), new Date());
  assert.equal(await job(), "failed after 1 earlier attempt");
  assert.equal(dispatches, 2);
  assert.equal(await job(), "refused", "a redelivered job cannot start a third generation");
  assert.equal(await job(), "refused", "a reaper re-enqueue draws on the same budget");
  assert.equal(dispatches, 2);
  assert.equal(await attempts(1), GENERATION_ATTEMPT_BUDGET);
  // A fresh request version has its own budget, also when the telemetry row was never written and claims race.
  const raced = await Promise.all(Array.from({ length: 6 }, () => claimGenerationAttempt(key(2))));
  assert.equal(raced.filter(Boolean).length, GENERATION_ATTEMPT_BUDGET);
  assert.equal(await attempts(2), GENERATION_ATTEMPT_BUDGET);

  const balance = async () => { const row = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } }); return Number(row.creditBalance) + Number(row.freeCreditBalance); };
  const usage = { provider: "openai" as const, model: "gpt-fixture", operation: "review", inputTokens: 1, outputTokens: 1, organizationId: org.id };
  const start = await balance();
  await logAiUsage({ ...usage, chargeKey: `fixture:${id}:sequential` });
  await logAiUsage({ ...usage, chargeKey: `fixture:${id}:sequential` });
  assert.equal(await balance(), start - 1, "the same charge key debits once");
  await Promise.all(Array.from({ length: 6 }, () => logAiUsage({ ...usage, chargeKey: `fixture:${id}:concurrent` })));
  assert.equal(await balance(), start - 2, "concurrent writes with one charge key debit once");
  const keyed = await prisma.aiUsage.findMany({ where: { organizationId: org.id, chargeKey: { not: null } } });
  assert.deepEqual(keyed.map(row => row.chargedCostUsd), [1, 1]);
  await logAiUsage(usage);
  await logAiUsage(usage);
  assert.equal(await balance(), start - 4, "writes without a key debit every time, as before");
  await logAiUsage({ ...usage, operation: "review-failed-attempt", inputTokens: 0, outputTokens: 0, usageUnknown: true });
  assert.equal(await balance(), start - 4, "a failed attempt is never charged");
  const unknown = await prisma.aiUsage.findMany({ where: { organizationId: org.id, usageUnknown: true } });
  assert.deepEqual(unknown.map(row => [row.operation, row.chargedCostUsd, row.usedOwnKey]), [["review-failed-attempt", null, false]]);
  assert.equal(await prisma.aiUsage.count({ where: { organizationId: org.id } }), 5);
  assert.equal(await prisma.creditTransaction.count({ where: { organizationId: org.id, type: "usage" } }), 4);
} finally { console.log = log; console.error = error; await prisma.organization.delete({ where: { id: org.id } }); await prisma.$disconnect(); }
console.log("PASS durable generation budget and idempotent review charge");
