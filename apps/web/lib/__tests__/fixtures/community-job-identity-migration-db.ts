import { mock } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { localQueueTestDatabaseUrl } from "../queue-test-database";

process.env.DATABASE_URL = localQueueTestDatabaseUrl(process.env.DATABASE_URL);
mock.module("server-only", () => ({}));
const { prisma } = await import("@octopus/db");
const schema = `community_identity_${randomUUID().replaceAll("-", "")}`;
let created = false;
try {
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  created = true;
  const sql = await readFile(new URL("../../../../../packages/db/prisma/migrations/20261108123000_community_job_repository_external_id/migration.sql", import.meta.url), "utf8");
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
    await tx.$executeRaw`CREATE TABLE community_review_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, "repoFullName" TEXT NOT NULL)`;
    await tx.$executeRaw`INSERT INTO community_review_jobs (id, status, "repoFullName") VALUES ('synthetic', 'reviewing', 'synthetic/repo')`;
    await tx.$executeRawUnsafe(sql);
    const [legacy] = await tx.$queryRaw<Array<{ repositoryExternalId: string | null; status: string; repoFullName: string }>>`SELECT "repositoryExternalId", status, "repoFullName" FROM community_review_jobs WHERE id = 'synthetic'`;
    assert.equal(legacy.repositoryExternalId, null);
    assert.equal(legacy.status, "reviewing");
    assert.equal(legacy.repoFullName, "synthetic/repo");
    await tx.$executeRaw`UPDATE community_review_jobs SET "repositoryExternalId" = 'synthetic-id' WHERE id = 'synthetic'`;
    const [bound] = await tx.$queryRaw<Array<{ repositoryExternalId: string }>>`SELECT "repositoryExternalId" FROM community_review_jobs WHERE id = 'synthetic'`;
    assert.equal(bound.repositoryExternalId, "synthetic-id");
  });
} finally {
  if (created) await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await prisma.$disconnect();
}
