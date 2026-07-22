/**
 * Same-origin check for state-changing browser requests (CSRF defence-in-depth).
 * Better Auth session cookies are SameSite=Lax (so a cross-site POST already
 * carries no cookie → 401), but an explicit Origin/Referer host check guards
 * against a future cookie-policy change and hostile-extension script POSTs.
 *
 * The Origin/Referer host is validated against the app's CONFIGURED canonical
 * host (BETTER_AUTH_URL / NEXT_PUBLIC_APP_URL) — the same source middleware uses
 * for redirect bases. Behind a reverse proxy the request `Host` header may be
 * rewritten to an internal value, so comparing a browser Origin against the raw
 * Host gives false negatives (every legitimate same-origin request rejected).
 * The request Host is kept as an additional accepted value so self-hosted / dev
 * deployments with no canonical URL configured still work.
 */
export function isSameOrigin(
  host: string | null,
  origin: string | null,
  referer: string | null,
): boolean {
  const allowed = new Set<string>();
  const canonical =
    process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (canonical) {
    try {
      allowed.add(new URL(canonical).host.toLowerCase());
    } catch {
      // Ignore a malformed configured URL; fall back to the request host.
    }
  }
  if (host) allowed.add(host.toLowerCase());
  if (allowed.size === 0) return false;

  const hostOf = (value: string): string | null => {
    try {
      return new URL(value).host.toLowerCase();
    } catch {
      return null;
    }
  };

  if (origin) {
    const h = hostOf(origin);
    return h !== null && allowed.has(h);
  }
  // No Origin — fall back to Referer for the small legacy-client window.
  if (referer) {
    const h = hostOf(referer);
    return h !== null && allowed.has(h);
  }
  return false;
}
