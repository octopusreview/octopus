/**
 * One-shot backfill: encrypt legacy plaintext AI provider keys at rest.
 *
 * Organizations store per-org AI provider keys (OpenAI, Anthropic, Google,
 * Cohere). The runtime now writes ciphertext and reads via
 * `decryptStringMaybeLegacy`, so existing plaintext rows keep working. This
 * script flips remaining plaintext values over to ciphertext so all rows are
 * uniform and a future commit can drop the "maybe-legacy" fallback.
 *
 * Strategy per field:
 *   1. Try decrypt: if it succeeds, value is already ciphertext → skip.
 *   2. Otherwise treat as plaintext, encrypt, and update.
 *
 * Usage:
 *   Dry run (default):  bun run --cwd apps/web scripts/encrypt-ai-keys.ts
 *   Apply changes:      bun run --cwd apps/web scripts/encrypt-ai-keys.ts --apply
 */

import { prisma } from "@octopus/db";
import { decryptString, encryptString } from "@/lib/crypto";

const APPLY = process.argv.includes("--apply");

const KEY_FIELDS = [
  "openaiApiKey",
  "anthropicApiKey",
  "googleApiKey",
  "cohereApiKey",
] as const;

function isCiphertext(value: string): boolean {
  try {
    decryptString(value);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  // Encryption uses OCTOPUS_DATA_KEY when set, otherwise the legacy
  // BETTER_AUTH_SECRET-derived key — either one is enough to encrypt.
  if (!process.env.OCTOPUS_DATA_KEY && !process.env.BETTER_AUTH_SECRET) {
    console.error("Set OCTOPUS_DATA_KEY or BETTER_AUTH_SECRET to encrypt keys.");
    process.exit(1);
  }

  // Without BETTER_AUTH_SECRET the legacy decryption fallback is unavailable, so
  // ciphertext written under the old BETTER_AUTH_SECRET-derived key would not be
  // recognized by isCiphertext() and would get re-encrypted (double-encrypted).
  // Only safe when every row is already under OCTOPUS_DATA_KEY.
  if (process.env.OCTOPUS_DATA_KEY && !process.env.BETTER_AUTH_SECRET) {
    console.warn(
      "[encrypt-ai-keys] BETTER_AUTH_SECRET is not set: legacy ciphertext cannot be detected. " +
        "Only run this if all existing keys are already encrypted under OCTOPUS_DATA_KEY.\n",
    );
  }

  console.log(
    APPLY
      ? "[encrypt-ai-keys] APPLY mode\n"
      : "[encrypt-ai-keys] DRY RUN (use --apply to persist)\n",
  );

  const rows = await prisma.organization.findMany({
    select: {
      id: true,
      openaiApiKey: true,
      anthropicApiKey: true,
      googleApiKey: true,
      cohereApiKey: true,
    },
  });

  const perField: Record<string, number> = {
    openaiApiKey: 0,
    anthropicApiKey: 0,
    googleApiKey: 0,
    cohereApiKey: 0,
  };
  let orgsUpdated = 0;

  for (const row of rows) {
    const data: Record<string, string> = {};
    for (const field of KEY_FIELDS) {
      const value = row[field];
      if (!value || isCiphertext(value)) continue;
      perField[field]++;
      data[field] = encryptString(value);
    }
    if (Object.keys(data).length === 0) continue;
    orgsUpdated++;
    if (!APPLY) continue;
    await prisma.organization.update({ where: { id: row.id }, data });
  }

  console.log(`Organizations scanned:  ${rows.length}`);
  console.log(`Organizations to update: ${orgsUpdated}\n`);
  console.log("Field             To encrypt");
  console.log("----------------- ----------");
  for (const field of KEY_FIELDS) {
    console.log(`${field.padEnd(17)} ${String(perField[field]).padStart(10)}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
