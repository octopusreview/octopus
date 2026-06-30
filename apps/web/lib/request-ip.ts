/**
 * Extract the client IP from request headers, preferring server-set headers
 * that a client cannot spoof, and falling back to the LAST hop of
 * x-forwarded-for (the nearest proxy) — never the first (client-controlled)
 * entry. Returns null when no usable header is present; callers that need a
 * non-null key append their own fallback (e.g. `getClientIp(h) ?? "unknown"`).
 *
 * TODO(proxy-trust): this trusts whatever the edge / reverse proxy sets. A full
 * trusted-hop-count / TRUSTED_PROXY configuration is out of scope; self-hosted
 * operators must ensure their reverse proxy overwrites these headers rather than
 * passing client-supplied values through.
 */
export function getClientIp(headers: Headers): string | null {
  return (
    headers.get("cf-connecting-ip") ||
    headers.get("x-real-ip") ||
    headers.get("x-forwarded-for")?.split(",").pop()?.trim() ||
    null
  );
}
