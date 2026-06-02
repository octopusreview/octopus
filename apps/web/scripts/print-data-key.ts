/**
 * Prints the value to set OCTOPUS_DATA_KEY to.
 *
 * Default (zero-migration upgrade): prints hex(sha256(BETTER_AUTH_SECRET)),
 * which is bit-identical to the key currently used by lib/crypto.ts. Setting
 * OCTOPUS_DATA_KEY to this value lets you decouple data encryption from
 * BETTER_AUTH_SECRET without re-encrypting any existing row, so BETTER_AUTH_SECRET
 * can then rotate freely.
 *
 *   bun run --cwd apps/web scripts/print-data-key.ts
 *
 * --new: prints a fresh random 32-byte key (hex). Use when you want a key that
 * was never derived from the auth secret; existing rows stay readable via the
 * legacy decrypt fallback, and new writes use the fresh key.
 *
 *   bun run --cwd apps/web scripts/print-data-key.ts --new
 */

import { createHash, randomBytes } from "node:crypto";

const NEW = process.argv.includes("--new");

if (NEW) {
  process.stdout.write(randomBytes(32).toString("hex") + "\n");
  process.exit(0);
}

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret) {
  console.error(
    "BETTER_AUTH_SECRET is not set in this environment, so the legacy-equivalent key cannot be computed. Use --new for a fresh random key instead.",
  );
  process.exit(1);
}

process.stdout.write(createHash("sha256").update(secret).digest("hex") + "\n");
