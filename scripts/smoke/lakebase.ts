#!/usr/bin/env bun
/**
 * Lakebase connection smoke test.
 *
 * Confirms the Prisma client can connect to Lakebase, reads a row count from
 * the `users` table, then sleeps 70 minutes and re-reads to prove the
 * async-password Pool refreshes the OAuth token across the 1-hour expiry.
 *
 * Run with --quick to skip the 70-minute sleep (default during dev).
 *
 * Requires: PGHOST/PGUSER/PGPASSWORD env (or DATABRICKS_* + databricks CLI).
 */

import { prisma } from "@octopus/db";

const quick = process.argv.includes("--quick");

async function main(): Promise<void> {
  console.log("[smoke] SELECT count(*) FROM users — initial");
  const before = await prisma.user.count();
  console.log(`[smoke]   ✅ users=${before}`);

  if (quick) {
    console.log("[smoke] --quick: skipping 70-minute idle test");
    return;
  }

  console.log("[smoke] idle for 70 minutes (token refresh test)...");
  await new Promise((r) => setTimeout(r, 70 * 60 * 1000));

  console.log("[smoke] SELECT count(*) FROM users — after idle");
  const after = await prisma.user.count();
  console.log(`[smoke]   ✅ users=${after} (token rotated successfully)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("[smoke] FAILED:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
