import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@octopus/db";

/** How often an instance heartbeats and re-reads the drain row. */
export const HEARTBEAT_INTERVAL_SECONDS = 3;
/** An instance is live while its last heartbeat is within three intervals. */
export const INSTANCE_LIVE_SECONDS = 3 * HEARTBEAT_INTERVAL_SECONDS;
/** A drain that has not gone quiescent by then is reported as timed_out. */
export const DEFAULT_DRAIN_DEADLINE_SECONDS = 20 * 60;
/** A caller polling every few seconds may miss many polls before workers resume by themselves. */
export const DEFAULT_DRAIN_LEASE_SECONDS = 120;
// Rows are per boot and never deleted here; status reports only the recent ones.
const INSTANCE_REPORT_SECONDS = 60 * 60;

export type DrainRow = { state: "claiming" | "draining"; generation: number; deadlineAt: Date | null; leaseUntil: Date | null };
export type DrainOutcome = "draining" | "quiescent" | "timed_out" | "lease_expired";

// Every timestamp comparison uses the database clock, so containers need not agree on the time.

/** Start a drain, or renew the lease of the one already running. */
export async function requestDrain({ deadlineSeconds = DEFAULT_DRAIN_DEADLINE_SECONDS, leaseSeconds = DEFAULT_DRAIN_LEASE_SECONDS, requestedBy }: {
  deadlineSeconds?: number; leaseSeconds?: number; requestedBy: string;
}): Promise<{ generation: number }> {
  const [row] = await prisma.$queryRaw<Array<{ generation: number }>>`
    INSERT INTO "queue_drain" ("id", "generation", "state", "requestedAt", "requestedBy", "deadlineAt", "leaseUntil")
    VALUES (1, 1, 'draining', now(), ${requestedBy}, now() + ${deadlineSeconds}::int * interval '1 second', now() + ${leaseSeconds}::int * interval '1 second')
    ON CONFLICT ("id") DO UPDATE SET
      "generation" = "queue_drain"."generation" + CASE WHEN "queue_drain"."state" = 'claiming' OR "queue_drain"."leaseUntil" <= clock_timestamp() THEN 1 ELSE 0 END,
      "state" = 'draining',
      "requestedAt" = CASE WHEN "queue_drain"."state" = 'claiming' OR "queue_drain"."leaseUntil" <= clock_timestamp() THEN clock_timestamp() ELSE "queue_drain"."requestedAt" END,
      "requestedBy" = CASE WHEN "queue_drain"."state" = 'claiming' OR "queue_drain"."leaseUntil" <= clock_timestamp() THEN EXCLUDED."requestedBy" ELSE "queue_drain"."requestedBy" END,
      "deadlineAt" = CASE WHEN "queue_drain"."state" = 'claiming' OR "queue_drain"."leaseUntil" <= clock_timestamp() THEN clock_timestamp() + ${deadlineSeconds}::int * interval '1 second' ELSE "queue_drain"."deadlineAt" END,
      "leaseUntil" = clock_timestamp() + ${leaseSeconds}::int * interval '1 second',
      "resumedAt" = NULL,
      "resumeReason" = NULL
    RETURNING "generation"`;
  return { generation: row.generation };
}

/** Compare-and-set back to claiming; false when the generation is stale or claiming already resumed. */
export async function resumeClaiming({ generation, reason }: { generation: number; reason: string }): Promise<boolean> {
  return await prisma.$executeRaw`
    UPDATE "queue_drain" SET "state" = 'claiming', "resumedAt" = now(), "resumeReason" = ${reason}
    WHERE "id" = 1 AND "generation" = ${generation} AND "state" = 'draining'` > 0;
}

export async function renewDrainLease(generation: number, leaseSeconds = DEFAULT_DRAIN_LEASE_SECONDS): Promise<boolean> {
  return await prisma.$executeRaw`
    UPDATE "queue_drain" SET "leaseUntil" = clock_timestamp() + ${leaseSeconds}::int * interval '1 second'
    WHERE "id" = 1 AND "generation" = ${generation} AND "state" = 'draining' AND "leaseUntil" > clock_timestamp()` > 0;
}

/** If whoever requested the drain stopped renewing it, workers resume by themselves. */
export async function expireDrainLease(): Promise<boolean> {
  return await prisma.$executeRaw`
    UPDATE "queue_drain" SET "state" = 'claiming', "resumedAt" = now(), "resumeReason" = 'lease_expired'
    WHERE "id" = 1 AND "state" = 'draining' AND "leaseUntil" <= now()` > 0;
}

export async function registerInstance(): Promise<string> {
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "queue_worker_instances" ("id", "serverId", "version", "workersEnabled")
    VALUES (${id}, ${process.env.OCTOPUS_SERVER_ID || "unknown"}, ${process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}, ${process.env.ENABLE_REVIEW_WORKERS === "true"})`;
  return id;
}

/** Record liveness and return the drain row in the same round trip. */
export async function heartbeat(instanceId: string, { inlineActive }: { inlineActive: number }): Promise<DrainRow> {
  const [row] = await prisma.$queryRaw<Array<{ [K in keyof DrainRow]: DrainRow[K] | null }>>`
    WITH beat AS (
      UPDATE "queue_worker_instances" SET "heartbeatAt" = now(), "inlineActive" = ${inlineActive}::int
      WHERE "id" = ${instanceId} RETURNING 1
    )
    SELECT d."state", d."generation", d."deadlineAt", d."leaseUntil"
    FROM (SELECT count(*) FROM beat) b LEFT JOIN "queue_drain" d ON d."id" = 1`;
  return { state: row.state ?? "claiming", generation: row.generation ?? 0, deadlineAt: row.deadlineAt, leaseUntil: row.leaseUntil };
}

export async function acknowledgeDrain(instanceId: string, generation: number): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "queue_worker_instances" SET "ackedGeneration" = ${generation}, "ackedAt" = now() WHERE "id" = ${instanceId}`;
}

export async function markRetiring(instanceId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "queue_worker_instances" SET "retiringAt" = now() WHERE "id" = ${instanceId} AND "retiringAt" IS NULL`;
}

export async function drainStatus() {
  // Read acknowledgements before work counts: once every live instance has acknowledged, no new work starts.
  const [drain] = await prisma.$queryRaw<Array<DrainRow & { resumeReason: string | null; deadlinePassed: boolean | null; leaseExpired: boolean | null }>>`
    SELECT "state", "generation", "deadlineAt", "leaseUntil", "resumeReason",
      "deadlineAt" <= now() AS "deadlinePassed", "leaseUntil" <= now() AS "leaseExpired"
    FROM "queue_drain" WHERE "id" = 1`;
  const state = drain?.state ?? "claiming";
  const generation = drain?.generation ?? 0;
  const rows = await prisma.$queryRaw<Array<{ serverId: string; version: string; workersEnabled: boolean; ackedGeneration: number | null; inlineActive: number; retiring: boolean; live: boolean }>>`
    SELECT "serverId", "version", "workersEnabled", "ackedGeneration", "inlineActive",
      "retiringAt" IS NOT NULL AS "retiring",
      "retiringAt" IS NULL AND "heartbeatAt" > now() - ${INSTANCE_LIVE_SECONDS}::int * interval '1 second' AS "live"
    FROM "queue_worker_instances"
    WHERE "heartbeatAt" > now() - ${INSTANCE_REPORT_SECONDS}::int * interval '1 second'
    ORDER BY "serverId", "startedAt"`;
  const instances = rows.map(({ ackedGeneration, ...row }) => ({ ...row, acked: ackedGeneration === generation }));
  const activeClaims = await prisma.$queryRaw<Array<{ queue: string; count: number }>>`
    SELECT "name" AS "queue", count(*)::int AS "count" FROM pgboss.job
    WHERE "state" = ${"active"}::pgboss.job_state GROUP BY "name" ORDER BY "name"`;
  const pendingDeliveries = await prisma.reviewAttemptDelivery.count({ where: { leaseUntil: { gt: new Date() } } });

  const live = instances.filter(instance => instance.live);
  const active = activeClaims.reduce((sum, claim) => sum + claim.count, 0);
  const inlineActive = live.reduce((sum, instance) => sum + instance.inlineActive, 0);
  const draining = state === "draining";
  const quiescent = draining && live.every(instance => instance.acked) && active === 0 && inlineActive === 0 && pendingDeliveries === 0;
  // pg-boss does not record which process holds a job, so this cannot tell a job an acknowledged worker
  // is still finishing from one whose worker died. Either way the job blocks until it ends or pg-boss expires it.
  const orphanedClaims = draining && !live.some(instance => instance.workersEnabled && !instance.acked) ? active : 0;
  const outcome: DrainOutcome | null = !draining ? (drain?.resumeReason === "lease_expired" ? "lease_expired" : null)
    : drain.leaseExpired ? "lease_expired"
    : quiescent ? "quiescent"
    : drain.deadlinePassed ? "timed_out" : "draining";
  return {
    state, generation, deadlineAt: drain?.deadlineAt ?? null, leaseUntil: drain?.leaseUntil ?? null,
    instances, activeClaims, inlineActive, pendingDeliveries, orphanedClaims, quiescent, outcome,
  };
}
