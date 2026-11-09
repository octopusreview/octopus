import "server-only";
import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@octopus/db";
import type { PgBoss } from "pg-boss";

export async function rememberDeferredIndex(
  tx: Prisma.TransactionClient,
  input: { repositoryId: string; organizationId: string; installationId: number; indexAttemptId: string },
): Promise<void> {
  const jobId = randomUUID();
  await tx.$executeRaw`
    INSERT INTO "github_deferred_indexes" ("repositoryId", "organizationId", "installationId", "indexAttemptId", "jobId")
    VALUES (${input.repositoryId}, ${input.organizationId}, ${input.installationId}, ${input.indexAttemptId}, ${jobId}::uuid)
    ON CONFLICT ("repositoryId") DO UPDATE SET
      "organizationId" = EXCLUDED."organizationId", "installationId" = EXCLUDED."installationId",
      "indexAttemptId" = EXCLUDED."indexAttemptId", "jobId" = EXCLUDED."jobId", "createdAt" = clock_timestamp()`;
}

type DeferredRow = {
  repositoryId: string; organizationId: string; installationId: number; indexAttemptId: string; jobId: string;
  actualOrganizationId: string | null; provider: string | null; repoInstallationId: number | null;
  indexStatus: string | null; currentAttemptId: string | null; active: boolean | null; dismissedAt: Date | null;
  orgInstallationId: number | null; orgDeletedAt: Date | null; orgBannedAt: Date | null; autoDiscover: boolean | null;
};

/** The outbox row and pg-boss job commit together, including on worker crashes. */
export async function dispatchDeferredIndexes(boss: PgBoss): Promise<number> {
  let queued = 0;
  for (let i = 0; i < 20; i++) {
    const result = await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<DeferredRow[]>`
        SELECT d."repositoryId", d."organizationId", d."installationId", d."indexAttemptId", d."jobId",
          r."organizationId" AS "actualOrganizationId", r."provider", r."installationId" AS "repoInstallationId",
          r."indexStatus", r."indexAttemptId" AS "currentAttemptId", r."isActive" AS "active", r."dismissedAt",
          o."githubInstallationId" AS "orgInstallationId", o."deletedAt" AS "orgDeletedAt",
          o."bannedAt" AS "orgBannedAt", o."autoDiscoverRepos" AS "autoDiscover"
        FROM "github_deferred_indexes" d
        LEFT JOIN "repositories" r ON r."id" = d."repositoryId"
        LEFT JOIN "organizations" o ON o."id" = d."organizationId"
        LEFT JOIN "github_index_rate_windows" w ON w."scope" = 'github-index-installation:' || d."installationId"::text
        WHERE w."scope" IS NULL OR (NOT w."paused" AND w."notBefore" <= clock_timestamp() AND (w."leaseUntil" IS NULL OR w."leaseUntil" <= clock_timestamp()))
        ORDER BY d."createdAt", d."repositoryId"
        FOR UPDATE OF d SKIP LOCKED LIMIT 1`;
      const row = rows[0];
      if (!row) return "empty" as const;
      const eligible = row.actualOrganizationId === row.organizationId && row.provider === "github" && row.active === true &&
        row.dismissedAt === null && row.indexStatus === "failed" && row.currentAttemptId === row.indexAttemptId &&
        row.autoDiscover === true && row.orgDeletedAt === null && row.orgBannedAt === null &&
        row.orgInstallationId === row.installationId && (row.repoInstallationId === null || row.repoInstallationId === row.installationId);
      if (eligible) {
        const id = await boss.send("index-repository", {
          repositoryId: row.repositoryId, organizationId: row.organizationId, expectedAttemptId: row.indexAttemptId,
        }, {
          id: row.jobId,
          db: { executeSql: async (sql, values) => ({ rows: await tx.$queryRawUnsafe<unknown[]>(sql, ...(values ?? [])) }) },
        });
        if (id !== row.jobId) throw new Error("Deferred indexing could not be queued");
      }
      await tx.$executeRaw`DELETE FROM "github_deferred_indexes" WHERE "repositoryId" = ${row.repositoryId} AND "jobId" = ${row.jobId}::uuid`;
      return eligible ? "queued" as const : "discarded" as const;
    });
    if (result === "empty") break;
    if (result === "queued") queued++;
  }
  return queued;
}
