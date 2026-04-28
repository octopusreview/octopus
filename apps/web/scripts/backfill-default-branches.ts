/**
 * Backfill script: Re-resolve `defaultBranch` for GitHub repositories where
 * the value was stored incorrectly (e.g. "main" on a master repo because the
 * `installation_repositories` webhook payload omits `default_branch`).
 *
 * Strategy:
 *   1. Load all active GitHub repos that have an installationId.
 *   2. Group by installationId, fetch one token per group.
 *   3. For each repo, call GET /repos/{full_name} to read the real default_branch.
 *   4. Update DB rows where the value differs.
 *
 * Usage:
 *   Dry run (default):  bun run --cwd apps/web scripts/backfill-default-branches.ts
 *   Apply changes:      bun run --cwd apps/web scripts/backfill-default-branches.ts --apply
 */

import { prisma } from "@octopus/db";
import { getInstallationToken, getRepositoryDetails } from "@/lib/github";

const APPLY = process.argv.includes("--apply");

interface Mismatch {
  id: string;
  fullName: string;
  stored: string;
  actual: string;
  installationId: number;
}

async function main() {
  console.log(`[backfill] Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);

  const repos = await prisma.repository.findMany({
    where: {
      provider: "github",
      isActive: true,
      installationId: { not: null },
    },
    select: {
      id: true,
      fullName: true,
      defaultBranch: true,
      installationId: true,
      indexStatus: true,
    },
  });

  console.log(`[backfill] Loaded ${repos.length} active GitHub repos with an installation`);

  const byInstallation = new Map<number, typeof repos>();
  for (const r of repos) {
    if (r.installationId == null) continue;
    const list = byInstallation.get(r.installationId) ?? [];
    list.push(r);
    byInstallation.set(r.installationId, list);
  }

  const mismatches: Mismatch[] = [];
  const inaccessible: { id: string; fullName: string; installationId: number }[] = [];
  const tokenFailures: number[] = [];
  let scanned = 0;

  for (const [installationId, group] of byInstallation) {
    let token: string;
    try {
      token = await getInstallationToken(installationId);
    } catch (err) {
      console.error(`[backfill] Failed to mint token for installation=${installationId}:`, err);
      tokenFailures.push(installationId);
      continue;
    }

    for (const repo of group) {
      scanned++;
      const [owner, repoName] = repo.fullName.split("/");
      try {
        const details = await getRepositoryDetails(installationId, owner, repoName, token);
        if (!details) {
          inaccessible.push({ id: repo.id, fullName: repo.fullName, installationId });
          continue;
        }
        if (details.default_branch !== repo.defaultBranch) {
          mismatches.push({
            id: repo.id,
            fullName: repo.fullName,
            stored: repo.defaultBranch,
            actual: details.default_branch,
            installationId,
          });
        }
      } catch (err) {
        console.error(`[backfill] Failed to fetch details for ${repo.fullName}:`, err);
      }

      if (scanned % 50 === 0) {
        console.log(`[backfill] Scanned ${scanned}/${repos.length}...`);
      }
    }
  }

  console.log(`\n[backfill] Scan complete.`);
  console.log(`  Scanned:      ${scanned}`);
  console.log(`  Mismatches:   ${mismatches.length}`);
  console.log(`  Inaccessible: ${inaccessible.length}`);
  console.log(`  Token fails:  ${tokenFailures.length}`);

  if (mismatches.length > 0) {
    console.log(`\n[backfill] Branch mismatches:`);
    for (const m of mismatches) {
      console.log(`  ${m.fullName.padEnd(60)} ${m.stored} -> ${m.actual}`);
    }
  }

  if (inaccessible.length > 0) {
    console.log(`\n[backfill] Inaccessible (App lost access; left untouched):`);
    for (const r of inaccessible) {
      console.log(`  ${r.fullName} (installation=${r.installationId})`);
    }
  }

  if (!APPLY) {
    console.log(`\n[backfill] Dry run complete. Re-run with --apply to persist ${mismatches.length} updates.`);
    return;
  }

  if (mismatches.length === 0) {
    console.log(`\n[backfill] Nothing to update.`);
    return;
  }

  console.log(`\n[backfill] Applying ${mismatches.length} updates...`);
  let updated = 0;
  for (const m of mismatches) {
    await prisma.repository.update({
      where: { id: m.id },
      data: { defaultBranch: m.actual },
    });
    updated++;
  }
  console.log(`[backfill] Updated ${updated} repositories.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill] Fatal:", err);
    process.exit(1);
  });
