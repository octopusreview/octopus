#!/usr/bin/env bun
// Grant table-level permissions on Lakebase to the Octopus App service principal.
import { Client } from "pg";
import { spawnSync } from "node:child_process";

const APP_SP = "9e8c7027-003d-466d-bb5a-58fdbdf1c00e";
const HOST = "ep-winter-dew-d24er2px.database.us-east-1.cloud.databricks.com";
const PROFILE = "octopus-ai";

function sh(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

const credJson = sh("databricks", [
  "database",
  "generate-database-credential",
  "--profile", PROFILE,
  "--json", JSON.stringify({ instance_names: ["octopus-app"], request_id: `grant-${Date.now()}` }),
  "--output", "json",
]);
const cred = JSON.parse(credJson) as { token: string };

const userJson = sh("databricks", ["current-user", "me", "--profile", PROFILE, "--output", "json"]);
const userName = (JSON.parse(userJson) as { userName: string }).userName;

const client = new Client({
  host: HOST,
  port: 5432,
  user: userName,
  password: cred.token,
  database: "databricks_postgres",
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log(`connected as ${userName}`);

const stmts = [
  `GRANT USAGE ON SCHEMA public TO "${APP_SP}"`,
  `GRANT ALL ON ALL TABLES IN SCHEMA public TO "${APP_SP}"`,
  `GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "${APP_SP}"`,
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${APP_SP}"`,
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${APP_SP}"`,
  `CREATE SCHEMA IF NOT EXISTS pgboss`,
  `GRANT ALL ON SCHEMA pgboss TO "${APP_SP}"`,
  `GRANT ALL ON ALL TABLES IN SCHEMA pgboss TO "${APP_SP}"`,
  `ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT ALL ON TABLES TO "${APP_SP}"`,
];

for (const s of stmts) {
  try {
    await client.query(s);
    console.log(`✓ ${s}`);
  } catch (e) {
    console.log(`✗ ${s} → ${(e as Error).message}`);
  }
}
await client.end();
