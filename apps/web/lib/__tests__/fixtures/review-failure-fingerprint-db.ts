import { mock } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const db = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["postgres:", "postgresql:"].includes(db.protocol));
assert.ok(["localhost", "127.0.0.1"].includes(db.hostname));
assert.match(db.pathname.slice(1), /(^|[-_])test($|[-_])/);
assert.equal(db.search + db.hash, "");
mock.module("server-only", () => ({}));
const { prisma } = await import("@octopus/db");
const { saveReviewAttempt, hasReviewAttempt } = await import("../../review-attempt");
const { unknownReviewCoverage } = await import("../../review-coverage");

const org = await prisma.organization.create({ data: { name: "Synthetic", slug: `failure-fingerprint-${randomUUID()}` } });
try {
  const repo = await prisma.repository.create({ data: { organizationId: org.id, name: "Synthetic", fullName: "synthetic/repo", externalId: randomUUID() } });
  const pr = await prisma.pullRequest.create({ data: { repositoryId: repo.id, number: 1, title: "Synthetic", url: "https://example.invalid", author: "synthetic", headSha: "a".repeat(40), status: "reviewing" } });
  const coverage = { ...unknownReviewCoverage("github", "synthetic"), headSha: pr.headSha, reviewRequestVersion: pr.reviewRequestVersion };
  const id = randomUUID(), digest = "a".repeat(64), other = "b".repeat(64);
  const concurrent = await Promise.all([
    saveReviewAttempt(id, pr.id, coverage, "Safe failure", undefined, digest),
    saveReviewAttempt(id, pr.id, coverage, "Safe failure", undefined, digest),
  ]);
  assert.deepEqual(concurrent.sort(), [false, true]);
  assert.equal(await hasReviewAttempt(id, pr.id, coverage, "Safe failure", prisma, digest), true);
  await assert.rejects(saveReviewAttempt(id, pr.id, coverage, "Safe failure", undefined, other), /identity conflict/);
  const row = await prisma.reviewAttempt.findUniqueOrThrow({ where: { id } });
  assert.equal(row.failureFingerprint, digest);
  assert.equal(row.reviewBody, "Safe failure");
  const legacy = randomUUID();
  await saveReviewAttempt(legacy, pr.id, coverage, "Historical failure");
  assert.equal(await hasReviewAttempt(legacy, pr.id, coverage, "Historical failure"), true);
  await assert.rejects(saveReviewAttempt(legacy, pr.id, coverage, "Historical failure", undefined, digest), /identity conflict/);
} finally {
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.$disconnect();
}
