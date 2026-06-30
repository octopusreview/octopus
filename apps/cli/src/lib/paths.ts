import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";

/**
 * Resolve the Octopus home directory.
 * Override via `OCTOPUS_HOME` (trusted operator/test config) for non-standard
 * installs. The override is resolved to an absolute path so a relative or
 * `..`-containing value can't land config/credentials somewhere surprising
 * relative to the current working directory.
 */
export function getOctopusHome(): string {
  const override = process.env.OCTOPUS_HOME;
  if (override) return resolve(override);
  return join(homedir(), ".octopus");
}

/**
 * config.json is GLOBAL (machine-level prefs + the first-run onboarding gate),
 * shared across accounts/profiles. Only credentials + BYOK keys are
 * per-profile (see getCredentialsPath / getByokPath below).
 */
export function getConfigPath(): string {
  return join(getOctopusHome(), "config.json");
}

export const DEFAULT_PROFILE = "default";

/** The secret-free index that records the known profiles + the active one. */
export function getProfilesIndexPath(): string {
  return join(getOctopusHome(), "profiles.json");
}

/** Per-profile directory holding that profile's `credentials` + `byok.json`. */
export function getProfileDir(name: string): string {
  return join(getOctopusHome(), "profiles", name);
}

/**
 * Validate a profile name BEFORE it is ever used as a directory component.
 * Security boundary: the name becomes `profiles/<name>`, so an unguarded
 * "." / ".." / path separator would escape the profiles dir and let
 * account create/remove/switch — or a tampered profiles.json read back through
 * here — touch arbitrary directories. Lives in paths.ts (not profile.ts) so the
 * sync path resolver below can use it without a circular import; profile.ts
 * re-exports it.
 */
export function isValidProfileName(name: string): boolean {
  if (!name || name === "." || name === "..") return false;
  return /^[A-Za-z0-9._-]+$/.test(name);
}

// Per-invocation active-profile override, set from the global --account/--profile
// flag in index.tsx. Wins over the persisted active pointer for one process.
let activeOverride: string | null = null;
export function setActiveProfileOverride(name: string | null): void {
  activeOverride = name;
}

/**
 * Sync read of the persisted active-profile pointer so path resolution stays
 * synchronous (getCredentialsPath/getByokPath are consumed all over as plain
 * strings). Falls back to "default" when the index is missing/unparseable
 * (pre-migration or a fresh machine).
 */
function readActiveProfileSync(): string {
  try {
    const raw = readFileSync(getProfilesIndexPath(), "utf8");
    const parsed = JSON.parse(raw) as { active?: unknown };
    // Validate the persisted pointer too — a hand-edited/corrupted index must
    // not drive a traversal through getProfileDir() into a credential read/write.
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.active === "string" &&
      isValidProfileName(parsed.active)
    ) {
      return parsed.active;
    }
  } catch {
    // no index yet → default
  }
  return DEFAULT_PROFILE;
}

export function getActiveProfileName(): string {
  return activeOverride ?? readActiveProfileSync();
}

export function getCredentialsPath(): string {
  return join(getProfileDir(getActiveProfileName()), "credentials");
}

export function getByokPath(): string {
  return join(getProfileDir(getActiveProfileName()), "byok.json");
}

/**
 * Ensure the Octopus home directory AND the active profile's directory exist
 * with restrictive permissions. Idempotent — safe to call on every launch.
 * saveCredentials/setByokKey call this before writing, so the active profile
 * dir always exists by the time a secret is written into it.
 */
export async function ensureOctopusHome(): Promise<void> {
  await mkdir(getOctopusHome(), { recursive: true, mode: 0o700 });
  await mkdir(getProfileDir(getActiveProfileName()), { recursive: true, mode: 0o700 });
}
