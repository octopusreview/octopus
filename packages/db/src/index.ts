import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolConfig } from "pg";

/**
 * Octopus Prisma client.
 *
 * Two connection modes:
 *
 *  1. Databricks Lakebase Postgres (production)
 *     The Databricks App's `database` resource binding injects PGHOST / PGUSER
 *     / PGDATABASE / PGPORT but does NOT inject a password. We mint a Lakebase
 *     OAuth credential at runtime via:
 *       POST /oidc/v1/token                  → workspace M2M access token (JWT)
 *       POST /api/2.0/database/credentials   → Lakebase Postgres password (JWT)
 *     The Lakebase password is itself a JWT (Postgres expects it in the
 *     password field). Tokens expire ~1h, so we cache with a 50-min refresh
 *     buffer and the pg.Pool re-reads via async callback on every new
 *     physical connection.
 *
 *  2. Local DATABASE_URL (Docker dev)
 *     Standard Prisma connection string.
 *
 * Selection: PGHOST set → Lakebase mode; otherwise → DATABASE_URL mode.
 */

const useLakebase = Boolean(process.env.PGHOST);

// ─────────────────────────────────────────────────────────────────────────────
// Lakebase token vending (inline so packages/db has no apps/web dependency)
// ─────────────────────────────────────────────────────────────────────────────

let cachedWorkspaceToken: { token: string; expiresAt: number } | null = null;
let inflightWorkspaceToken: Promise<string> | null = null;

function normalizeHost(raw: string | undefined): string {
  let h = (raw ?? "").trim().replace(/\/$/, "");
  if (h && !/^https?:\/\//i.test(h)) h = `https://${h}`;
  return h;
}

async function mintWorkspaceToken(): Promise<string> {
  const host = normalizeHost(process.env.DATABRICKS_HOST);
  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
  if (!host || !clientId || !clientSecret) {
    throw new Error(
      "[octopus/db] Missing DATABRICKS_HOST / DATABRICKS_CLIENT_ID / DATABRICKS_CLIENT_SECRET for Lakebase token mint.",
    );
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({ grant_type: "client_credentials", scope: "all-apis" });
  const r = await fetch(`${host}/oidc/v1/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!r.ok) {
    throw new Error(`[octopus/db] OIDC token failed ${r.status}: ${await r.text().catch(() => "")}`);
  }
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cachedWorkspaceToken = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

async function getWorkspaceToken(): Promise<string> {
  if (cachedWorkspaceToken && Date.now() < cachedWorkspaceToken.expiresAt - 60_000) {
    return cachedWorkspaceToken.token;
  }
  if (inflightWorkspaceToken) return inflightWorkspaceToken;
  inflightWorkspaceToken = mintWorkspaceToken().finally(() => {
    inflightWorkspaceToken = null;
  });
  return inflightWorkspaceToken;
}

let cachedPgToken: { token: string; expiresAt: number } | null = null;
let inflightPgToken: Promise<string> | null = null;

async function mintPgToken(): Promise<string> {
  const host = normalizeHost(process.env.DATABRICKS_HOST);
  const project = process.env.LAKEBASE_PROJECT ?? "octopus-app";
  const wsToken = await getWorkspaceToken();
  const body = JSON.stringify({
    request_id: `octopus-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    instance_names: [project],
  });
  const r = await fetch(`${host}/api/2.0/database/credentials`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${wsToken}`,
      "Content-Type": "application/json",
    },
    body,
  });
  if (!r.ok) {
    throw new Error(
      `[octopus/db] generate-database-credential failed ${r.status}: ${await r.text().catch(() => "")}`,
    );
  }
  const j = (await r.json()) as { token: string; expiration_time?: string };
  const expiresAt =
    j.expiration_time && !Number.isNaN(Date.parse(j.expiration_time))
      ? Date.parse(j.expiration_time)
      : Date.now() + 60 * 60 * 1000;
  cachedPgToken = { token: j.token, expiresAt };
  return j.token;
}

async function getLakebasePassword(): Promise<string> {
  // If the platform DID inject PGPASSWORD (some future Apps version), prefer that.
  const fromEnv = process.env.PGPASSWORD ?? "";
  if (fromEnv.length > 0) return fromEnv;
  if (cachedPgToken && Date.now() < cachedPgToken.expiresAt - 5 * 60 * 1000) {
    return cachedPgToken.token;
  }
  if (inflightPgToken) return inflightPgToken;
  inflightPgToken = mintPgToken().finally(() => {
    inflightPgToken = null;
  });
  return inflightPgToken;
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot diagnostics — shows up once in app logs at first import.
// ─────────────────────────────────────────────────────────────────────────────
if (useLakebase) {
  const pw = process.env.PGPASSWORD ?? "";
  console.log(
    `[octopus/db] Lakebase mode: PGHOST=${process.env.PGHOST} PGUSER=${process.env.PGUSER} ` +
      `PGDATABASE=${process.env.PGDATABASE ?? "(default)"} PGPORT=${process.env.PGPORT ?? 5432} ` +
      `PGPASSWORD.injected=${pw.length > 0 ? "yes" : "no (will mint via OIDC + database/credentials)"}`,
  );
} else {
  console.log(
    `[octopus/db] DATABASE_URL mode (no PGHOST). url.length=${(process.env.DATABASE_URL ?? "").length}`,
  );
}

let pool: Pool;

if (useLakebase) {
  const poolConfig: PoolConfig = {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER,
    database: process.env.PGDATABASE ?? "databricks_postgres",
    ssl: { rejectUnauthorized: false },
    // Per-connection async password — re-minted/refreshed via Databricks OAuth
    // when expired (or first call). New physical connections get a fresh token.
    password: getLakebasePassword,
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
