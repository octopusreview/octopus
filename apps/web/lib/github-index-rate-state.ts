import "server-only";
import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@octopus/db";

type Probe = { kind: "probe"; token: string; version: bigint; paused: boolean; verifyPrimary: boolean; primaryResetMs: number | null; primaryBaseline: boolean };
type Admission = { kind: "open" } | { kind: "blocked"; retryAfterMs: number | null; paused: boolean } | Probe;

function validateScope(scope: string): void {
  if (!/^github-index:(?:[0-9a-f]{64})$/.test(scope) && !/^github-index-installation:[1-9]\d*$/.test(scope)) {
    throw new Error("GitHub index rate scope is unavailable");
  }
}

async function lockScope(tx: Prisma.TransactionClient, scope: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))`;
}

/** Keep the longest observed limit; unknown windows use bounded exponential probing. */
export async function recordIndexRateLimit(scope: string, durationMs: number | null, boundedRetry = durationMs === null,
  primary?: { resetMs: number | null }): Promise<{ paused: boolean }> {
  validateScope(scope);
  if (durationMs !== null && (!Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > 8.64e15)) {
    throw new Error("Invalid GitHub index rate window");
  }
  if (primary?.resetMs !== null && primary?.resetMs !== undefined &&
      (!Number.isSafeInteger(primary.resetMs) || primary.resetMs <= 0 || primary.resetMs > 8.64e15)) {
    throw new Error("Invalid GitHub index rate window");
  }
  return prisma.$transaction(async tx => {
    await lockScope(tx, scope);
    const rows = await tx.$queryRaw<Array<{ strikes: number; expired: boolean; paused: boolean; verifyPrimary: boolean; primaryResetMs: bigint | null; primaryBaseline: boolean }>>`
      SELECT "strikes", "paused", "verifyPrimary", "primaryResetMs", "primaryBaseline", "notBefore" <= clock_timestamp() AS "expired"
      FROM "github_index_rate_windows" WHERE "scope" = ${scope}`;
    const prior = rows[0];
    const strikes = boundedRetry ? Math.min(Math.max(1, (prior?.strikes ?? 0) + (!prior || prior.expired ? 1 : 0)), 7) : (prior?.paused ? prior.strikes : 0);
    const paused = !!prior?.paused || strikes >= 7;
    const verifyPrimary = !!primary || !!prior?.verifyPrimary;
    const previousReset = prior?.primaryResetMs === null || prior?.primaryResetMs === undefined ? null : Number(prior.primaryResetMs);
    const primaryReset = primary?.resetMs === null || primary?.resetMs === undefined ? previousReset : Math.max(previousReset ?? 0, primary.resetMs);
    const primaryBaseline = primary ? false : !!prior?.primaryBaseline;
    const delayMs = durationMs === null ? Math.min(60_000 * 2 ** Math.max(0, strikes - 1), 3_600_000) : Math.max(durationMs, 1_000);
    await tx.$executeRaw`
      INSERT INTO "github_index_rate_windows" ("scope", "notBefore", "strikes", "paused", "verifyPrimary", "primaryResetMs", "primaryBaseline")
      VALUES (${scope}, clock_timestamp() + ${delayMs}::double precision * interval '1 millisecond', ${strikes}, ${paused}, ${verifyPrimary}, ${primaryReset}::bigint, ${primaryBaseline})
      ON CONFLICT ("scope") DO UPDATE SET
        "notBefore" = GREATEST("github_index_rate_windows"."notBefore", EXCLUDED."notBefore"),
        "version" = "github_index_rate_windows"."version" + 1,
        "leaseToken" = NULL, "leaseUntil" = NULL, "strikes" = EXCLUDED."strikes", "paused" = EXCLUDED."paused",
        "verifyPrimary" = EXCLUDED."verifyPrimary", "primaryResetMs" = EXCLUDED."primaryResetMs", "primaryBaseline" = EXCLUDED."primaryBaseline", "updatedAt" = clock_timestamp()`;
    return { paused };
  });
}

/** The database clock governs both cooldowns and recovery leases. */
export async function admitIndexRequest(scope: string, allowPausedProbe = false): Promise<Admission> {
  validateScope(scope);
  return prisma.$transaction(async tx => {
    await lockScope(tx, scope);
    const rows = await tx.$queryRaw<Array<{ version: bigint; waitMs: bigint; paused: boolean; verifyPrimary: boolean; primaryResetMs: bigint | null; primaryBaseline: boolean }>>`
      SELECT "version", "paused", "verifyPrimary", "primaryResetMs", "primaryBaseline", GREATEST(0, CEIL(EXTRACT(EPOCH FROM
        (GREATEST("notBefore", COALESCE("leaseUntil", "notBefore")) - clock_timestamp())) * 1000))::bigint AS "waitMs"
      FROM "github_index_rate_windows" WHERE "scope" = ${scope}`;
    if (!rows.length) return { kind: "open" };
    const retryAfterMs = Number(rows[0].waitMs);
    if (retryAfterMs > 0 || (rows[0].paused && !allowPausedProbe)) {
      return { kind: "blocked", retryAfterMs: retryAfterMs || null, paused: rows[0].paused };
    }
    const token = randomUUID();
    await tx.$executeRaw`
      UPDATE "github_index_rate_windows" SET "leaseToken" = ${token},
        "leaseUntil" = clock_timestamp() + interval '2 minutes', "updatedAt" = clock_timestamp()
      WHERE "scope" = ${scope}`;
    return { kind: "probe", token, version: rows[0].version, paused: rows[0].paused, verifyPrimary: rows[0].verifyPrimary,
      primaryResetMs: rows[0].primaryResetMs === null ? null : Number(rows[0].primaryResetMs), primaryBaseline: rows[0].primaryBaseline };
  });
}

/** A quota overview establishes a future boundary; it cannot clear the exhausted response on its own. */
export async function deferPrimaryVerification(scope: string, probe: Probe, resetMs: number, durationMs: number): Promise<boolean> {
  validateScope(scope);
  if (!Number.isSafeInteger(resetMs) || resetMs <= 0 || resetMs > 8.64e15 ||
      !Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > 8.64e15) throw new Error("Invalid GitHub index rate window");
  return prisma.$transaction(async tx => {
    await lockScope(tx, scope);
    const count = await tx.$executeRaw`
      UPDATE "github_index_rate_windows" SET
        "notBefore" = GREATEST("notBefore", clock_timestamp() + ${Math.max(durationMs, 1000)}::double precision * interval '1 millisecond'),
        "primaryResetMs" = GREATEST(COALESCE("primaryResetMs", 0), ${resetMs}::bigint),
        "primaryBaseline" = true, "version" = "version" + 1, "leaseToken" = NULL, "leaseUntil" = NULL, "updatedAt" = clock_timestamp()
      WHERE "scope" = ${scope} AND "version" = ${probe.version} AND "leaseToken" = ${probe.token}
        AND "leaseUntil" > clock_timestamp() AND "verifyPrimary" = true`;
    return count === 1;
  });
}

/** A late or superseded worker cannot clear a newer observation or lease. */
export async function completeIndexRateProbe(scope: string, probe: Probe): Promise<boolean> {
  validateScope(scope);
  return prisma.$transaction(async tx => {
    await lockScope(tx, scope);
    const count = await tx.$executeRaw`
      DELETE FROM "github_index_rate_windows" WHERE "scope" = ${scope} AND "version" = ${probe.version}
        AND "leaseToken" = ${probe.token} AND "leaseUntil" > clock_timestamp()`;
    return count === 1;
  });
}
