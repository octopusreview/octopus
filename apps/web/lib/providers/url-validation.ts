/**
 * URL validation for provider base URLs accepted from per-org configuration.
 *
 * Several providers (ollama, acp, opencode, claude-code, future custom
 * endpoints) let an org admin set a `<provider>BaseUrl` column that becomes
 * the target of a server-side fetch. Without validation this is a classic
 * SSRF primitive — an admin can point at:
 *
 *   - cloud metadata endpoints (169.254.169.254 on AWS / Azure / GCP)
 *   - internal services on the deployment's VPC
 *   - arbitrary external hosts (for exfiltration of prompt content, which
 *     in code-review can include source code from indexed repos)
 *
 * Use `validateProviderUrl(raw, { hosted })` at the boundary where the
 * org-supplied URL becomes a `fetch()` baseURL. Throws on any rejection so
 * the provider can surface a clear error rather than performing the request.
 *
 * In self-hosted mode we permit private / loopback / link-local hosts since
 * those are how operators connect to Ollama-on-the-same-machine or
 * acp-on-an-internal-LAN. The `hosted` flag flips the default behavior:
 * hosted=true → block private ranges; hosted=false (or absent) → allow.
 */

export type UrlValidationOptions = {
  /**
   * When true, block private / loopback / link-local hosts. Defaults to
   * `process.env.SELF_HOSTED !== "true"` so cloud deployments are protected
   * by default and self-hosted users can point at localhost / 10.x / 192.168.x.
   */
  hosted?: boolean;
};

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,                                  // loopback
  /^0\.0\.0\.0$/,                            // IPv4 wildcard — Linux/macOS route this to loopback
  /^10\./,                                   // RFC1918
  /^192\.168\./,                             // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./,              // RFC1918
  /^169\.254\./,                             // link-local (cloud metadata!)
  /^fe80:/i,                                 // IPv6 link-local
  /^::1$/i,                                  // IPv6 loopback
  /^::$/,                                    // IPv6 unspecified
  /^::ffff:/i,                               // IPv4-mapped IPv6 — kernel routes to embedded v4 (bypasses 169.254. via [::ffff:169.254.169.254])
  /^fc[0-9a-f][0-9a-f]:/i,                   // IPv6 unique local (fc00::/7)
  /^fd[0-9a-f][0-9a-f]:/i,                   // IPv6 unique local
];

/**
 * Validate and normalize a provider base URL. Returns the canonical origin
 * (scheme + host + port) with any path / query / fragment stripped and
 * trailing slashes removed. Throws on rejection.
 */
export function validateProviderUrl(
  raw: string,
  options: UrlValidationOptions = {},
): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Provider URL is empty");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Provider URL is not parseable: ${trimmed.slice(0, 80)}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Provider URL must use http(s); got ${parsed.protocol}`);
  }

  const hosted = options.hosted ?? process.env.SELF_HOSTED !== "true";
  if (hosted) {
    // `URL.hostname` keeps surrounding brackets on IPv6 (e.g. "[::1]"), so
    // strip them before matching the `^`-anchored IPv6 patterns. Without this
    // the entire IPv6 family bypasses the denylist.
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (PRIVATE_HOST_PATTERNS.some((re) => re.test(host))) {
      throw new Error(
        `Provider URL host "${host}" is private/loopback/link-local; ` +
          "rejected in hosted mode (set SELF_HOSTED=true on the deployment if intentional).",
      );
    }
  }

  // Return origin only — drop any path / query / fragment that came in.
  return parsed.origin;
}
