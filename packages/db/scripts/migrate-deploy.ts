#!/usr/bin/env bun
/**
 * Run `prisma migrate deploy` against Lakebase Postgres using a freshly-minted
 * OAuth token. Run from a developer machine with `databricks` CLI authed.
 *
 * Usage:
 *   bun run db:deploy:databricks
 *   # or directly:
 *   bun packages/db/scripts/migrate-deploy.ts
 *
 * Env vars consumed:
 *   DATABRICKS_PROFILE   (default "octopus-ai")
 *   LAKEBASE_PROJECT     (default "octopus-app")
 *
 * Mints a 1-hour Postgres credential via `databricks database generate-database-credential`,
 * composes DATABASE_URL, and spawns `bunx --filter @octopus/db prisma migrate deploy`.
 */

import { spawnSync } from "node:child_process";

const profile = process.env.DATABRICKS_PROFILE ?? "octopus-ai";
const project = process.env.LAKEBASE_PROJECT ?? "octopus-app";

function sh(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf-8" });
  if (r.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}\n${r.stderr}`);
  }
  return r.stdout;
}

console.log(`Migrating Lakebase Postgres project=${project} profile=${profile}`);

const credJson = sh("databricks", [
  "database",
  "generate-database-credential",
  "--profile",
  profile,
  "--instance-names",
  project,
  "--request-id",
  `octopus-migrate-${Date.now()}`,
  "--output",
  "json",
]);
const cred = JSON.parse(credJson) as { token: string };

const instanceJson = sh("databricks", [
  "database",
  "get-database-instance",
  "--profile",
  profile,
  project,
  "--output",
  "json",
]);
const instance = JSON.parse(instanceJson) as { read_write_dns?: string; host?: string };
const host = instance.read_write_dns ?? instance.host;
if (!host) throw new Error(`Could not determine host for Lakebase project ${project}`);

const userJson = sh("databricks", ["current-user", "me", "--profile", profile, "--output", "json"]);
const user = (JSON.parse(userJson) as { userName?: string; user_name?: string });
const userName = user.userName ?? user.user_name;
if (!userName) throw new Error("Could not determine current user");

const databaseUrl = `postgresql://${encodeURIComponent(userName)}:${encodeURIComponent(cred.token)}@${host}:5432/databricks_postgres?sslmode=require`;

console.log(`Connecting as ${userName}@${host}/databricks_postgres ...`);

const migrate = spawnSync("bunx", ["--filter", "@octopus/db", "prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: databaseUrl },
});

process.exit(migrate.status ?? 1);
