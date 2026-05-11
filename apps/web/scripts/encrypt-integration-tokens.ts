/**
 * One-shot backfill: encrypt legacy plaintext OAuth tokens at rest.
 *
 * The runtime now writes ciphertext for new/refreshed tokens, and reads via
 * `decryptStringMaybeLegacy` so existing plaintext rows keep working. This
 * script flips remaining plaintext rows over to ciphertext so all rows are
 * uniform and a future commit can drop the "maybe-legacy" fallback.
 *
 * Strategy per row:
 *   1. Try decrypt: if it succeeds, value is already ciphertext → skip.
 *   2. Otherwise treat as plaintext, encrypt, and update.
 *
 * Usage:
 *   Dry run (default):  bun run --cwd apps/web scripts/encrypt-integration-tokens.ts
 *   Apply changes:      bun run --cwd apps/web scripts/encrypt-integration-tokens.ts --apply
 */

import { prisma } from "@octopus/db";
import { decryptString, encryptString } from "@/lib/crypto";

const APPLY = process.argv.includes("--apply");

function isCiphertext(value: string): boolean {
  try {
    decryptString(value);
    return true;
  } catch {
    return false;
  }
}

type Migrated = { table: string; checked: number; encrypted: number };

async function migrateBitbucket(): Promise<Migrated> {
  const rows = await prisma.bitbucketIntegration.findMany({
    select: { id: true, accessToken: true, refreshToken: true },
  });
  let encrypted = 0;
  for (const row of rows) {
    const accessNeeds = !isCiphertext(row.accessToken);
    const refreshNeeds = !isCiphertext(row.refreshToken);
    if (!accessNeeds && !refreshNeeds) continue;
    encrypted++;
    if (!APPLY) continue;
    await prisma.bitbucketIntegration.update({
      where: { id: row.id },
      data: {
        accessToken: accessNeeds ? encryptString(row.accessToken) : row.accessToken,
        refreshToken: refreshNeeds ? encryptString(row.refreshToken) : row.refreshToken,
      },
    });
  }
  return { table: "bitbucketIntegration", checked: rows.length, encrypted };
}

async function migrateGitlab(): Promise<Migrated> {
  const rows = await prisma.gitlabIntegration.findMany({
    select: { id: true, accessToken: true, refreshToken: true },
  });
  let encrypted = 0;
  for (const row of rows) {
    const accessNeeds = !isCiphertext(row.accessToken);
    const refreshNeeds = !isCiphertext(row.refreshToken);
    if (!accessNeeds && !refreshNeeds) continue;
    encrypted++;
    if (!APPLY) continue;
    await prisma.gitlabIntegration.update({
      where: { id: row.id },
      data: {
        accessToken: accessNeeds ? encryptString(row.accessToken) : row.accessToken,
        refreshToken: refreshNeeds ? encryptString(row.refreshToken) : row.refreshToken,
      },
    });
  }
  return { table: "gitlabIntegration", checked: rows.length, encrypted };
}

async function migrateSlack(): Promise<Migrated> {
  const rows = await prisma.slackIntegration.findMany({
    select: { id: true, accessToken: true },
  });
  let encrypted = 0;
  for (const row of rows) {
    if (isCiphertext(row.accessToken)) continue;
    encrypted++;
    if (!APPLY) continue;
    await prisma.slackIntegration.update({
      where: { id: row.id },
      data: { accessToken: encryptString(row.accessToken) },
    });
  }
  return { table: "slackIntegration", checked: rows.length, encrypted };
}

async function migrateLinear(): Promise<Migrated> {
  const rows = await prisma.linearIntegration.findMany({
    select: { id: true, accessToken: true },
  });
  let encrypted = 0;
  for (const row of rows) {
    if (isCiphertext(row.accessToken)) continue;
    encrypted++;
    if (!APPLY) continue;
    await prisma.linearIntegration.update({
      where: { id: row.id },
      data: { accessToken: encryptString(row.accessToken) },
    });
  }
  return { table: "linearIntegration", checked: rows.length, encrypted };
}

// Jira has written ciphertext from the start, so this is normally a no-op.
// Included for completeness so the backfill covers every integration with
// OAuth tokens (and to catch any anomalous plaintext rows from older data).
async function migrateJira(): Promise<Migrated> {
  const rows = await prisma.jiraIntegration.findMany({
    select: { id: true, accessToken: true, refreshToken: true },
  });
  let encrypted = 0;
  for (const row of rows) {
    const accessNeeds = !isCiphertext(row.accessToken);
    const refreshNeeds = !isCiphertext(row.refreshToken);
    if (!accessNeeds && !refreshNeeds) continue;
    encrypted++;
    if (!APPLY) continue;
    await prisma.jiraIntegration.update({
      where: { id: row.id },
      data: {
        accessToken: accessNeeds ? encryptString(row.accessToken) : row.accessToken,
        refreshToken: refreshNeeds ? encryptString(row.refreshToken) : row.refreshToken,
      },
    });
  }
  return { table: "jiraIntegration", checked: rows.length, encrypted };
}

async function main() {
  if (!process.env.BETTER_AUTH_SECRET) {
    console.error("BETTER_AUTH_SECRET is required to encrypt tokens.");
    process.exit(1);
  }

  console.log(APPLY ? "[encrypt-tokens] APPLY mode\n" : "[encrypt-tokens] DRY RUN (use --apply to persist)\n");

  const results = [
    await migrateBitbucket(),
    await migrateGitlab(),
    await migrateSlack(),
    await migrateLinear(),
    await migrateJira(),
  ];

  console.log("Table                      Checked   To encrypt");
  console.log("-------------------------- -------   ----------");
  for (const r of results) {
    console.log(
      `${r.table.padEnd(26)} ${String(r.checked).padStart(7)}   ${String(r.encrypted).padStart(10)}`,
    );
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
