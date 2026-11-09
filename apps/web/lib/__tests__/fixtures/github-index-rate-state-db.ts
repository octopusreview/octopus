import { mock } from "bun:test";
import assert from "node:assert/strict";

const db = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["postgres:", "postgresql:"].includes(db.protocol));
assert.ok(["localhost", "127.0.0.1"].includes(db.hostname));
assert.match(db.pathname.slice(1), /(^|[-_])test($|[-_])/);
assert.equal(db.search + db.hash, "");
mock.module("server-only", () => ({}));
const { prisma } = await import("@octopus/db");
const { admitIndexRequest, completeIndexRateProbe, recordIndexRateLimit } = await import("../../github-index-rate-state");
const scope = "github-index-installation:123";
const other = "github-index-installation:456";

try {
  await prisma.$executeRaw`DELETE FROM "github_index_rate_windows"`;
  assert.deepEqual(await admitIndexRequest(scope), { kind: "open" });
  await recordIndexRateLimit(scope, 3_600_000);
  const denied = await admitIndexRequest(scope);
  assert.equal(denied.kind, "blocked");
  if (denied.kind !== "blocked") throw new Error("expected blocked");
  assert.ok(denied.retryAfterMs > 3_500_000);
  await recordIndexRateLimit(scope, 5_000);
  const stillDenied = await admitIndexRequest(scope);
  assert.equal(stillDenied.kind, "blocked");
  if (stillDenied.kind !== "blocked") throw new Error("expected blocked");
  assert.ok(stillDenied.retryAfterMs > 3_500_000, "a shorter observation cannot shorten the window");
  assert.deepEqual(await admitIndexRequest(other), { kind: "open" });
  await Promise.all([recordIndexRateLimit(other, null), recordIndexRateLimit(other, null)]);
  const backedOff = await admitIndexRequest(other);
  assert.equal(backedOff.kind, "blocked");
  if (backedOff.kind !== "blocked") throw new Error("expected blocked");
  assert.ok(backedOff.retryAfterMs > 50_000 && backedOff.retryAfterMs <= 60_000, "concurrent responses from one window do not multiply the delay");
  await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${other}`;
  await recordIndexRateLimit(other, null);
  const retried = await admitIndexRequest(other);
  assert.equal(retried.kind, "blocked");
  if (retried.kind !== "blocked") throw new Error("expected blocked");
  assert.ok(retried.retryAfterMs > 110_000, "a new failed probe increases the delay");
  await assert.rejects(recordIndexRateLimit("raw-token", 1000), /scope/i);
  await assert.rejects(recordIndexRateLimit(scope, -1), /window/i);
  await assert.rejects(recordIndexRateLimit(scope, 8.64e15 + 1), /window/i);

  await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${scope}`;
  const admissions = await Promise.all(Array.from({ length: 20 }, () => admitIndexRequest(scope)));
  const probes = admissions.filter(admission => admission.kind === "probe");
  assert.equal(probes.length, 1, "only one worker can probe the expired window");
  assert.equal(admissions.filter(admission => admission.kind === "blocked").length, 19);
  const oldProbe = probes[0];
  if (oldProbe.kind !== "probe") throw new Error("expected probe");
  await recordIndexRateLimit(scope, null);
  assert.equal(await completeIndexRateProbe(scope, oldProbe), false, "an old success cannot erase a newer limit");
  const renewed = await admitIndexRequest(scope);
  assert.equal(renewed.kind, "blocked");
  if (renewed.kind !== "blocked") throw new Error("expected blocked");
  assert.ok(renewed.retryAfterMs > 50_000, "unknown reset gets a bounded recovery delay");

  await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second', "leaseUntil" = clock_timestamp() - interval '1 second' WHERE "scope" = ${scope}`;
  const first = await admitIndexRequest(scope);
  assert.equal(first.kind, "probe");
  if (first.kind !== "probe") throw new Error("expected probe");
  await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "leaseUntil" = clock_timestamp() - interval '1 second' WHERE "scope" = ${scope}`;
  assert.equal(await completeIndexRateProbe(scope, first), false, "an expired lease cannot clear the window");
  const replacement = await admitIndexRequest(scope);
  assert.equal(replacement.kind, "probe");
  if (replacement.kind !== "probe") throw new Error("expected probe");
  assert.equal(await completeIndexRateProbe(scope, first), false, "an expired worker cannot clear a replacement lease");
  assert.equal(await completeIndexRateProbe(scope, replacement), true);
  assert.deepEqual(await admitIndexRequest(scope), { kind: "open" });
} finally {
  await prisma.$executeRaw`DELETE FROM "github_index_rate_windows"`;
  await prisma.$disconnect();
}
