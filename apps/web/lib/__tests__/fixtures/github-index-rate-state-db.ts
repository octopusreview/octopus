import { assertDisposableIndexDatabase } from "./disposable-index-db";
import { mock } from "bun:test";
import assert from "node:assert/strict";

assertDisposableIndexDatabase();
mock.module("server-only", () => ({}));
const { prisma } = await import("@octopus/db");
const { admitIndexRequest, completeIndexRateProbe, deferPrimaryVerification, pruneExpiredIndexRateWindows, recordIndexRateLimit } = await import("../../github-index-rate-state");
const scope = "github-index-installation:123";
const other = "github-index-installation:456";

try {
  await prisma.$executeRaw`DELETE FROM "github_index_rate_windows"`;
  assert.deepEqual(await admitIndexRequest(scope), { kind: "open" });
  await recordIndexRateLimit(scope, 3_600_000);
  const denied = await admitIndexRequest(scope);
  assert.equal(denied.kind, "blocked");
  if (denied.kind !== "blocked") throw new Error("expected blocked");
  assert.ok((denied.retryAfterMs ?? 0) > 3_500_000);
  await recordIndexRateLimit(scope, 5_000);
  const stillDenied = await admitIndexRequest(scope);
  assert.equal(stillDenied.kind, "blocked");
  if (stillDenied.kind !== "blocked") throw new Error("expected blocked");
  assert.ok((stillDenied.retryAfterMs ?? 0) > 3_500_000, "a shorter observation cannot shorten the window");
  assert.deepEqual(await admitIndexRequest(other), { kind: "open" });
  await Promise.all([recordIndexRateLimit(other, null), recordIndexRateLimit(other, null)]);
  const backedOff = await admitIndexRequest(other);
  assert.equal(backedOff.kind, "blocked");
  if (backedOff.kind !== "blocked") throw new Error("expected blocked");
  assert.ok(backedOff.retryAfterMs !== null && backedOff.retryAfterMs > 50_000 && backedOff.retryAfterMs <= 60_000, "concurrent responses from one window do not multiply the delay");
  await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${other}`;
  await recordIndexRateLimit(other, null);
  const retried = await admitIndexRequest(other);
  assert.equal(retried.kind, "blocked");
  if (retried.kind !== "blocked") throw new Error("expected blocked");
  assert.ok((retried.retryAfterMs ?? 0) > 110_000, "a new failed probe increases the delay");
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
  assert.ok((renewed.retryAfterMs ?? 0) > 50_000, "unknown reset gets a bounded recovery delay");

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

  const pausedScope = "github-index-installation:789";
  for (let i = 0; i < 7; i++) {
    await recordIndexRateLimit(pausedScope, null);
    if (i < 6) await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${pausedScope}`;
  }
  const earlyManual = await admitIndexRequest(pausedScope, true);
  assert.equal(earlyManual.kind, "blocked", "manual retries still honor the cooldown");
  await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${pausedScope}`;
  const paused = await admitIndexRequest(pausedScope);
  assert.equal(paused.kind, "blocked");
  if (paused.kind !== "blocked") throw new Error("expected blocked");
  assert.equal(paused.paused, true, "automatic probes stop after repeated unknown limits");
  const manual = await admitIndexRequest(pausedScope, true);
  assert.equal(manual.kind, "probe");
  if (manual.kind !== "probe") throw new Error("expected probe");
  assert.equal(await completeIndexRateProbe(pausedScope, manual), true);
  assert.deepEqual(await admitIndexRequest(pausedScope), { kind: "open" });
  const explicitScope = "github-index-installation:790";
  for (let i = 0; i < 7; i++) {
    await recordIndexRateLimit(explicitScope, 1000, true);
    await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${explicitScope}`;
  }
  const explicit = await admitIndexRequest(explicitScope);
  assert.equal(explicit.kind, "blocked");
  if (explicit.kind !== "blocked") throw new Error("expected blocked");
  assert.equal(explicit.paused, true, "explicit secondary retry guidance also has a retry limit");

  const quotaScope = "github-index-installation:791";
  await recordIndexRateLimit(quotaScope, null, true, { resetMs: 1_900_000_000_000 });
  await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '1 second' WHERE "scope" = ${quotaScope}`;
  const oldQuotaProbe = await admitIndexRequest(quotaScope);
  assert.equal(oldQuotaProbe.kind, "probe");
  if (oldQuotaProbe.kind !== "probe") throw new Error("expected probe");
  await recordIndexRateLimit(quotaScope, 3_600_000, false, { resetMs: 1_900_003_600_000 });
  assert.equal(await deferPrimaryVerification(quotaScope, oldQuotaProbe, 1_900_000_000_000, 1000), false,
    "a stale quota check cannot overwrite a newer primary observation");
  const currentQuota = await admitIndexRequest(quotaScope);
  assert.equal(currentQuota.kind, "blocked");
  if (currentQuota.kind !== "blocked") throw new Error("expected blocked");
  assert.ok((currentQuota.retryAfterMs ?? 0) > 3_500_000);

  const expired = "github-index-installation:792", unresolved = "github-index-installation:793", leased = "github-index-installation:794";
  await recordIndexRateLimit(expired, 1000);
  await recordIndexRateLimit(unresolved, null, true, { resetMs: null });
  await recordIndexRateLimit(leased, 1000);
  await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '31 days',
    "updatedAt" = clock_timestamp() - interval '31 days' WHERE "scope" IN (${expired}, ${unresolved}, ${leased})`;
  await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "leaseUntil" = clock_timestamp() + interval '1 hour' WHERE "scope" = ${leased}`;
  const pruned = await Promise.all([pruneExpiredIndexRateWindows(), pruneExpiredIndexRateWindows()]);
  assert.equal(pruned[0] + pruned[1], 1, "concurrent cleanup removes one settled window");
  const retained = await prisma.$queryRaw<Array<{ scope: string }>>`SELECT "scope" FROM "github_index_rate_windows" WHERE "scope" IN (${expired}, ${unresolved}, ${leased})`;
  assert.deepEqual(retained.map(row => row.scope).sort(), [leased, unresolved].sort(), "unresolved and leased windows remain");
  for (let i = 0; i < 10; i++) {
    await recordIndexRateLimit(expired, 1000);
    await prisma.$executeRaw`UPDATE "github_index_rate_windows" SET "notBefore" = clock_timestamp() - interval '31 days',
      "updatedAt" = clock_timestamp() - interval '31 days' WHERE "scope" = ${expired}`;
    await Promise.all([recordIndexRateLimit(expired, 3_600_000), pruneExpiredIndexRateWindows()]);
    const fresh = await admitIndexRequest(expired);
    assert.equal(fresh.kind, "blocked");
    if (fresh.kind !== "blocked") throw new Error("expected blocked");
    assert.ok((fresh.retryAfterMs ?? 0) > 3_500_000, "cleanup cannot erase a concurrently renewed limit");
  }
} finally {
  await prisma.$executeRaw`DELETE FROM "github_index_rate_windows"`;
  await prisma.$disconnect();
}
