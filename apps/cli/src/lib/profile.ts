import { mkdir, readFile, writeFile, chmod, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  getOctopusHome,
  getProfilesIndexPath,
  getProfileDir,
  DEFAULT_PROFILE,
  isValidProfileName,
} from "./paths.js";
import type { Credentials } from "./credentials.js";

/**
 * Multi-profile ("account") support. Each profile is a directory under
 * ~/.octopus/profiles/<name>/ holding that profile's `credentials` + `byok.json`
 * (per-profile secrets). A small, secret-free index (~/.octopus/profiles.json)
 * records the known profiles and which one is active.
 *
 * Path resolution (which profile dir credentials/byok live in) is in paths.ts
 * and stays synchronous; this module owns the async index operations +
 * migration. config.json stays global (machine prefs + onboarding gate).
 */

export const PROFILES_VERSION = 1;

export type ProfilesIndex = {
  version: number;
  active: string | null;
  profiles: Record<string, { createdAt: string }>;
};

// The profile-name guard lives in paths.ts (so the sync path resolver can use
// it without a paths↔profile import cycle); re-exported here for callers that
// already import from this module.
export { isValidProfileName };

function assertValidProfileName(name: string): void {
  if (!isValidProfileName(name)) {
    throw new Error(
      `Invalid account name "${name}". Use letters, digits, dot, dash, or underscore (not "." or "..").`,
    );
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function loadProfilesIndex(): Promise<ProfilesIndex> {
  try {
    const raw = await readFile(getProfilesIndexPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ProfilesIndex>;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.profiles === "object" &&
      parsed.profiles !== null &&
      // `typeof [] === "object"` — reject an array so Object.keys doesn't yield
      // numeric indices as "profile names" (same trap byok.ts guards against).
      !Array.isArray(parsed.profiles)
    ) {
      // Only trust validly-named keys: the name becomes a directory component,
      // so a tampered/corrupted index must not introduce a traversal name into
      // listProfiles / loadCredentialsForProfile. Coerce each entry's shape.
      const profiles: ProfilesIndex["profiles"] = {};
      for (const [name, entry] of Object.entries(
        parsed.profiles as Record<string, { createdAt?: unknown }>,
      )) {
        if (!isValidProfileName(name)) continue;
        profiles[name] = {
          createdAt: typeof entry?.createdAt === "string" ? entry.createdAt : "",
        };
      }
      const active =
        typeof parsed.active === "string" && isValidProfileName(parsed.active) && profiles[parsed.active]
          ? parsed.active
          : null;
      return { version: PROFILES_VERSION, active, profiles };
    }
  } catch {
    // missing / unparseable → empty index
  }
  return { version: PROFILES_VERSION, active: null, profiles: {} };
}

async function saveProfilesIndex(index: ProfilesIndex): Promise<void> {
  await mkdir(getOctopusHome(), { recursive: true, mode: 0o700 });
  const p = getProfilesIndexPath();
  await writeFile(p, JSON.stringify(index, null, 2), { mode: 0o600 });
  // mode only applies on creation; force 0600 on pre-existing files too
  // (matches credentials.ts / byok.ts).
  await chmod(p, 0o600);
}

/**
 * One-time migration from the legacy single-context layout to per-profile dirs.
 * Idempotent: returns immediately once profiles.json exists. Otherwise moves
 * any existing ~/.octopus/credentials + byok.json into profiles/default/ via
 * `rename` (atomic on the same filesystem, preserves the exact 0600 bytes) so
 * the user is NOT logged out, then writes the index with active="default".
 *
 * Wrapped so a migration failure (perms etc.) leaves the legacy files in place
 * and the index unwritten — the CLI keeps running and retries next launch
 * rather than crashing or silently logging the user out.
 */
export async function ensureProfilesMigrated(): Promise<void> {
  try {
    if (await fileExists(getProfilesIndexPath())) return;
    const home = getOctopusHome();
    const defaultDir = getProfileDir(DEFAULT_PROFILE);
    await mkdir(defaultDir, { recursive: true, mode: 0o700 });

    const legacyCreds = join(home, "credentials");
    if (await fileExists(legacyCreds)) {
      await rename(legacyCreds, join(defaultDir, "credentials"));
    }
    const legacyByok = join(home, "byok.json");
    if (await fileExists(legacyByok)) {
      await rename(legacyByok, join(defaultDir, "byok.json"));
    }

    await saveProfilesIndex({
      version: PROFILES_VERSION,
      active: DEFAULT_PROFILE,
      profiles: { [DEFAULT_PROFILE]: { createdAt: new Date().toISOString() } },
    });
  } catch {
    // leave legacy files untouched; retry on next launch
  }
}

/** Create the profile dir + register it in the index (no-op if already present). */
export async function ensureProfile(name: string): Promise<void> {
  assertValidProfileName(name);
  await mkdir(getProfileDir(name), { recursive: true, mode: 0o700 });
  const index = await loadProfilesIndex();
  if (!index.profiles[name]) {
    index.profiles[name] = { createdAt: new Date().toISOString() };
    await saveProfilesIndex(index);
  }
}

export async function setActiveProfile(name: string): Promise<void> {
  assertValidProfileName(name);
  const index = await loadProfilesIndex();
  if (!index.profiles[name]) throw new Error(`No such account: ${name}`);
  index.active = name;
  await saveProfilesIndex(index);
}

/** Remove a profile (dir + index entry). Auto-repoints active to a remaining
 *  profile when the removed one was active; unsets active only when none remain. */
export async function removeProfile(name: string): Promise<{ newActive: string | null }> {
  assertValidProfileName(name);
  const index = await loadProfilesIndex();
  if (!index.profiles[name]) throw new Error(`No such account: ${name}`);
  delete index.profiles[name];
  if (index.active === name) {
    const remaining = Object.keys(index.profiles).sort();
    index.active = remaining.length > 0 ? remaining[0] : null;
  }
  await saveProfilesIndex(index);
  // Best-effort dir removal — the index is the source of truth; a leftover dir
  // is harmless and gets reused if the name is re-created.
  await rm(getProfileDir(name), { recursive: true, force: true }).catch(() => {});
  return { newActive: index.active };
}

/** Best-effort read of a SPECIFIC profile's credentials (for `account list`). */
export async function loadCredentialsForProfile(name: string): Promise<Credentials | null> {
  if (!isValidProfileName(name)) return null; // defense-in-depth: never readFile a traversal name
  try {
    const raw = await readFile(join(getProfileDir(name), "credentials"), "utf8");
    const parsed = JSON.parse(raw) as Credentials;
    if (parsed && typeof parsed === "object" && typeof parsed.token === "string") return parsed;
  } catch {
    // missing / unparseable → not signed in on this profile
  }
  return null;
}

export type ProfileSummary = { name: string; active: boolean; creds: Credentials | null };

export async function listProfiles(): Promise<ProfileSummary[]> {
  const index = await loadProfilesIndex();
  const names = Object.keys(index.profiles).sort();
  const out: ProfileSummary[] = [];
  for (const name of names) {
    out.push({ name, active: index.active === name, creds: await loadCredentialsForProfile(name) });
  }
  return out;
}
