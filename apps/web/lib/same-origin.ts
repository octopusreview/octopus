/**
 * Same-origin check for state-changing browser POSTs (CSRF defence-in-depth).
 * Better Auth session cookies are SameSite=Lax (so a cross-site POST already
 * carries no cookie → 401), but an explicit Origin/Referer host check guards
 * against a future cookie-policy change and hostile-extension script POSTs.
 *
 * (The agent-revoke route has an equivalent local copy; this is the shared
 * version for new endpoints.)
 */
export function isSameOrigin(
  host: string | null,
  origin: string | null,
  referer: string | null,
): boolean {
  if (!host) return false;
  const expected = host.toLowerCase();
  if (origin) {
    try {
      return new URL(origin).host.toLowerCase() === expected;
    } catch {
      return false;
    }
  }
  // No Origin — fall back to Referer for the small legacy-client window.
  if (referer) {
    try {
      return new URL(referer).host.toLowerCase() === expected;
    } catch {
      return false;
    }
  }
  return false;
}
