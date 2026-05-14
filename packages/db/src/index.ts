import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolConfig } from "pg";

/**
 * Octopus Prisma client.
 *
 * Two connection modes:
 *
 *  1. Databricks Lakebase Postgres (production)
 *     The Databricks App injects PGHOST / PGUSER / PGDATABASE / PGPORT and a
 *     short-lived PGPASSWORD (OAuth token, ~1h TTL, refreshed by the platform).
 *     We use a `pg.Pool` whose `password` is an async callback — every new
 *     physical connection re-reads PGPASSWORD, so token rotation is automatic.
 *     Aggressive idleTimeoutMillis recycles connections before token decay.
 *
 *  2. Local DATABASE_URL (Docker dev)
 *     Standard Prisma connection string. The adapter uses a static password.
 *
 * Selection: if PGHOST is set, use the Pool path; otherwise fall back to
 * connection string. This keeps `docker compose up` working unchanged.
 */

const useLakebase = Boolean(process.env.PGHOST);

let pool: Pool;

if (useLakebase) {
  const poolConfig: PoolConfig = {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER,
    database: process.env.PGDATABASE ?? "databricks_postgres",
    ssl: { rejectUnauthorized: false },
    // Per-connection async password — re-read at every new physical connection.
    // The Databricks App platform keeps PGPASSWORD fresh in-process.
    password: async (): Promise<string> => process.env.PGPASSWORD ?? "",
    idleTimeoutMillis: 30_000,
    max: 10,
  };
  pool = new Pool(poolConfig);
} else {
  // Local dev — vanilla connection string.
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
}

const adapter = new PrismaPg(pool);

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/** Shared pg.Pool — used by pg-boss to inherit the same auth refresh behaviour. */
export { pool };

export { PrismaClient } from "@prisma/client";
export type * from "@prisma/client";
