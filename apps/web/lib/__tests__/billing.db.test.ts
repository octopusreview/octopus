import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const RUN_DB_TESTS = process.env.RUN_BILLING_DB_TESTS === "1";

function assertDedicatedTestDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "RUN_BILLING_DB_TESTS=1 requires DATABASE_URL for a dedicated test database",
    );
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (!/(^|[-_])test($|[-_])/.test(databaseName.toLowerCase())) {
    throw new Error(
      `Refusing to run billing DB tests against non-test database "${databaseName}"`,
    );
  }
}

if (RUN_DB_TESTS) {
  assertDedicatedTestDatabase();
  mock.module("server-only", () => ({}));
  mock.module("@/lib/stripe", () => ({
    getStripe: () => {
      throw new Error("Stripe must not be called by the billing DB test");
    },
    getOffSessionPaymentMethodId: () => Promise.resolve(null),
  }));
  mock.module("@/lib/events/bus", () => ({
    eventBus: {
      emit: () => {},
      on: () => {},
      off: () => {},
    },
  }));
}

type DbModule = typeof import("@octopus/db");
type CreditsModule = typeof import("@/lib/credits");

let prisma: DbModule["prisma"];
let grantAutoReloadFromPaymentIntent: CreditsModule["grantAutoReloadFromPaymentIntent"];

if (RUN_DB_TESTS) {
  ({ prisma } = await import("@octopus/db"));
  ({ grantAutoReloadFromPaymentIntent } = await import("@/lib/credits"));
}

const describeDb = RUN_DB_TESTS ? describe : describe.skip;
const fixtureId = randomUUID().replaceAll("-", "");
const organizationId = `billing_db_org_${fixtureId}`;
const migrationSchema = `billing_migration_${fixtureId}`;
const migrationUrl = new URL(
  "../../../../packages/db/prisma/migrations/20260810120000_add_auto_reload_attempts/migration.sql",
  import.meta.url,
);

function quotedIdentifier(identifier: string): string {
  if (!/^[a-z0-9_]+$/.test(identifier)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function migrationStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function attemptData(label: string, activeOrganizationId: string | null) {
  const now = Date.now();
  return {
    id: `billing_db_attempt_${label}_${fixtureId}`,
    status: "pending",
    idempotencyKey: `billing-db-${label}-${fixtureId}`,
    amountCents: 5_000,
    stripeCustomerId: `cus_billing_db_${fixtureId}`,
    stripePaymentMethodId: `pm_billing_db_${fixtureId}`,
    leaseExpiresAt: new Date(now + 5 * 60 * 1_000),
    retryUntil: new Date(now + 23 * 60 * 60 * 1_000),
    organizationId,
    activeOrganizationId,
  };
}

describeDb("billing auto-reload invariants with PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Billing DB Test",
        slug: `billing-db-${fixtureId}`,
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("enforces one active claim and completes duplicate grants exactly once", async () => {
    const claims = await Promise.allSettled([
      prisma.autoReloadAttempt.create({
        data: attemptData("claim-a", organizationId),
      }),
      prisma.autoReloadAttempt.create({
        data: attemptData("claim-b", organizationId),
      }),
    ]);

    const winner = claims.find((claim) => claim.status === "fulfilled");
    const loser = claims.find((claim) => claim.status === "rejected");
    expect(claims.filter((claim) => claim.status === "fulfilled")).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === "rejected")).toHaveLength(1);
    if (!winner || winner.status !== "fulfilled") {
      throw new Error("Expected one auto-reload claim to succeed");
    }
    if (!loser || loser.status !== "rejected") {
      throw new Error("Expected one auto-reload claim to lose the unique slot");
    }
    expect(loser.reason).toMatchObject({ code: "P2002" });

    const paymentIntentId = `pi_billing_db_${fixtureId}`;
    const attemptIdentity = {
      id: winner.value.id,
      idempotencyKey: winner.value.idempotencyKey,
    };

    await Promise.all([
      grantAutoReloadFromPaymentIntent(
        organizationId,
        50,
        paymentIntentId,
        null,
        attemptIdentity,
      ),
      grantAutoReloadFromPaymentIntent(
        organizationId,
        50,
        paymentIntentId,
        null,
        attemptIdentity,
      ),
    ]);

    const [organization, transactions, completedAttempt] = await Promise.all([
      prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { creditBalance: true, freeCreditBalance: true },
      }),
      prisma.creditTransaction.findMany({
        where: { organizationId, stripeSessionId: paymentIntentId },
      }),
      prisma.autoReloadAttempt.findUniqueOrThrow({
        where: { id: winner.value.id },
      }),
    ]);

    expect(Number(organization.creditBalance)).toBe(50);
    expect(Number(organization.freeCreditBalance)).toBe(0);
    expect(transactions).toHaveLength(1);
    expect(Number(transactions[0]?.amount)).toBe(50);
    expect(transactions[0]?.type).toBe("auto_reload");
    expect(completedAttempt.status).toBe("completed");
    expect(completedAttempt.activeOrganizationId).toBeNull();
    expect(completedAttempt.stripePaymentIntentId).toBe(paymentIntentId);
    expect(completedAttempt.completedAt).toBeInstanceOf(Date);

    const replacement = await prisma.autoReloadAttempt.create({
      data: attemptData("replacement", organizationId),
    });
    const retainedHistory = await prisma.autoReloadAttempt.create({
      data: {
        ...attemptData("history", null),
        status: "completed",
        completedAt: new Date(),
      },
    });

    expect(replacement.activeOrganizationId).toBe(organizationId);
    expect(retainedHistory.activeOrganizationId).toBeNull();
    expect(
      await prisma.autoReloadAttempt.count({
        where: { organizationId, activeOrganizationId: null },
      }),
    ).toBe(2);
  });

  it("applies the durable-attempt migration safely to legacy auto-reload rows", async () => {
    const schema = quotedIdentifier(migrationSchema);
    const migrationSql = await readFile(migrationUrl, "utf8");

    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`CREATE SCHEMA ${schema}`);
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${schema}`);
        await tx.$executeRawUnsafe(`
          CREATE TABLE "organizations" (
            "id" TEXT NOT NULL PRIMARY KEY
          )
        `);
        await tx.$executeRawUnsafe(`
          CREATE TABLE "auto_reload_configs" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "enabled" BOOLEAN NOT NULL DEFAULT false,
            "thresholdAmount" NUMERIC(12, 4) NOT NULL DEFAULT 10,
            "reloadAmount" NUMERIC(12, 4) NOT NULL DEFAULT 50,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL,
            "organizationId" TEXT NOT NULL UNIQUE,
            CONSTRAINT "auto_reload_configs_organizationId_fkey"
              FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
              ON DELETE CASCADE ON UPDATE CASCADE
          )
        `);
        await tx.$executeRawUnsafe(`
          INSERT INTO "organizations" ("id")
          VALUES ('org-enabled'), ('org-disabled')
        `);
        await tx.$executeRawUnsafe(`
          INSERT INTO "auto_reload_configs" (
            "id",
            "enabled",
            "thresholdAmount",
            "reloadAmount",
            "updatedAt",
            "organizationId"
          ) VALUES
            ('config-enabled', true, 12.5000, 73.2500, CURRENT_TIMESTAMP, 'org-enabled'),
            ('config-disabled', false, 8.7500, 41.5000, CURRENT_TIMESTAMP, 'org-disabled')
        `);

        for (const statement of migrationStatements(migrationSql)) {
          await tx.$executeRawUnsafe(statement);
        }

        const configs = await tx.$queryRawUnsafe<
          Array<{
            id: string;
            enabled: boolean;
            paused: boolean;
            threshold: string;
            reload: string;
          }>
        >(`
          SELECT
            "id",
            "enabled",
            "pausedForDurableUpgrade" AS "paused",
            "thresholdAmount"::text AS "threshold",
            "reloadAmount"::text AS "reload"
          FROM "auto_reload_configs"
          ORDER BY "id"
        `);
        expect(configs).toEqual([
          {
            id: "config-disabled",
            enabled: false,
            paused: false,
            threshold: "8.7500",
            reload: "41.5000",
          },
          {
            id: "config-enabled",
            enabled: false,
            paused: true,
            threshold: "12.5000",
            reload: "73.2500",
          },
        ]);

        const attemptTable = await tx.$queryRawUnsafe<Array<{ exists: boolean }>>(`
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = '${migrationSchema}'
              AND table_name = 'auto_reload_attempts'
          ) AS "exists"
        `);
        expect(attemptTable).toEqual([{ exists: true }]);

        const paymentMethodColumn = await tx.$queryRawUnsafe<
          Array<{ isNullable: string }>
        >(`
          SELECT is_nullable AS "isNullable"
          FROM information_schema.columns
          WHERE table_schema = '${migrationSchema}'
            AND table_name = 'auto_reload_attempts'
            AND column_name = 'stripePaymentMethodId'
        `);
        expect(paymentMethodColumn).toEqual([{ isNullable: "YES" }]);
      });
    } finally {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
  });
});
