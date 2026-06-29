import { chmod, readFile, writeFile, unlink } from "node:fs/promises";
import { ensureOctopusHome, getCredentialsPath } from "./paths.js";

/**
 * Auth state for the hosted Octopus API (or a self-hosted instance with the
 * same device-flow endpoints). Stored as a separate file from prefs and BYOK
 * keys so it can be revoked / deleted in isolation.
 *
 * File: ~/.octopus/credentials, mode 0600.
 */
export type Credentials = {
  /** API base URL — `https://octopus-review.ai` for hosted, custom for self-hosted. */
  baseUrl: string;
  /** Long-lived API token returned by the approve flow. */
  token: string;
  /** Org context at the time of approval. */
  orgId: string;
  orgSlug: string;
  orgName: string;
  /** User identity at the time of approval (display purposes only). */
  userName?: string;
  userEmail?: string;
  /** ISO timestamp of when the token was issued. */
  approvedAt: string;
};

/**
 * Load credentials. Returns null when the file is missing, unreadable, or
 * has the wrong shape — never throws. Callers treat null as "not signed in."
 */
export async function loadCredentials(): Promise<Credentials | null> {
  try {
    const raw = await readFile(getCredentialsPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (isCredentials(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function saveCredentials(c: Credentials): Promise<void> {
  await ensureOctopusHome();
  const p = getCredentialsPath();
  await writeFile(p, JSON.stringify(c, null, 2), { mode: 0o600 });
  // writeFile's `mode` only applies on file CREATION. If the file already
  // exists with looser bits (older build, sync tool, different umask),
  // rewriting leaves the loose bits intact. chmod after the write so the
  // documented 0600 guarantee holds on pre-existing files too.
  await chmod(p, 0o600);
}

/**
 * Remove the credentials file. No-op if absent.
 *
 * We `unlink` rather than truncate so callers using a `stat`-based "is the
 * user signed in?" check see the file actually disappear. `loadCredentials`
 * already tolerates a missing file (returns null), so this is purely a
 * disk-state correctness fix.
 */
export async function clearCredentials(): Promise<void> {
  try {
    await unlink(getCredentialsPath());
  } catch (e) {
    // ENOENT is fine — file already gone is the success state. Anything
    // else (EPERM, EBUSY, file-locked-on-Windows, EROFS) means the token
    // is STILL on disk; the sign-out attempt did not complete. Surface
    // so the caller can warn the user rather than silently claiming
    // success while their credential is still readable.
    if (e instanceof Error && "code" in e && (e as { code: string }).code === "ENOENT") return;
    throw e;
  }
}

function isCredentials(value: unknown): value is Credentials {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.baseUrl === "string" &&
    typeof v.token === "string" &&
    typeof v.orgId === "string" &&
    typeof v.orgSlug === "string" &&
    typeof v.orgName === "string" &&
    typeof v.approvedAt === "string"
  );
}
