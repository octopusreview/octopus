// Pure helpers extracted from `route.ts` so they're testable without the
// Next.js runtime / Prisma client / fetch boundary. The route imports each
// of these by name and wires them to the request handler.

import crypto from "node:crypto";

/**
 * Strict same-origin path guard. Rejects anything that could escape the app
 * origin via path encoding tricks:
 *   - `/\evil.com` (Windows-style path)
 *   - `/%2Fevil.com` (URL-encoded leading slash)
 *   - `/%5Cevil.com` (URL-encoded backslash)
 *   - protocol-relative `//evil.com`
 *   - absolute URLs (`https://evil.com`)
 *   - oversize payloads (>2KiB)
 *   - CR/LF injection (defense against header-injection downstream)
 *
 * Returns the input unchanged when safe; otherwise falls back to `/dashboard`.
 */
export function safeReturnTo(raw: string | null): string {
  const DEFAULT = "/dashboard";
  if (!raw) return DEFAULT;
  if (raw.length > 2048) return DEFAULT;
  if (/[\r\n]/.test(raw)) return DEFAULT;
  if (!raw.startsWith("/")) return DEFAULT;
  if (raw.length > 1 && (raw[1] === "/" || raw[1] === "\\")) return DEFAULT;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return DEFAULT;
  }
  if (decoded.length > 2048) return DEFAULT;
  if (decoded.length > 1 && (decoded[1] === "/" || decoded[1] === "\\")) return DEFAULT;
  if (/^[a-z]+:/i.test(decoded.trim()) && !decoded.startsWith("/")) return DEFAULT;
  return raw;
}

/** Mask an email for logging: `dermot.smyth@databricks.com` → `d***@databricks.com`. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** Generate a CUID-style id (`c<24 hex chars>`) for User/Session rows. */
export function cuid(): string {
  return `c${crypto.randomBytes(12).toString("hex")}`;
}

/** Strip a trailing slash and prepend `https://` if missing. */
export function normalizeHost(raw: string | undefined): string {
  let h = (raw ?? "").trim().replace(/\/$/, "");
  if (h && !/^https?:\/\//i.test(h)) h = `https://${h}`;
  return h;
}

/**
 * Sign the session token in Hono's signedCookie format (Better-Auth v1.x):
 *   `${token}.${base64(HMAC-SHA256(secret, token))}`
 *
 * KNOWN COUPLING: this manually replicates Better-Auth's signing. If
 * Better-Auth changes the format in a future major version, cookies minted
 * here will silently fail verify. Bump `version` (passed by caller) when
 * touching this — it's tracked at the call site for grep-ability.
 */
export function signSessionCookie(token: string, secret: string, _version: string): string {
  const hmac = crypto.createHmac("sha256", secret).update(token).digest();
  return `${token}.${hmac.toString("base64")}`;
}

/**
 * Parse a SCIM /Me response into an identity record. Returns null if the
 * response shape doesn't include a usable email — callers should treat that
 * as a 401-equivalent (Databricks proxy hasn't actually authenticated the
 * user, so we can't trust the headers either).
 */
export function parseScimIdentity(
  json: {
    id?: string;
    userName?: string;
    displayName?: string;
    emails?: Array<{ value?: string; primary?: boolean }>;
  },
  fallbackUserId: string | null,
): { email: string; name: string; dbxUserId: string | null } | null {
  const primaryEmail =
    json.emails?.find((e) => e.primary)?.value ||
    json.emails?.[0]?.value ||
    json.userName;
  if (!primaryEmail || !primaryEmail.includes("@")) return null;
  return {
    email: primaryEmail.trim().toLowerCase(),
    name: json.displayName || json.userName || primaryEmail,
    dbxUserId: json.id ?? fallbackUserId,
  };
}
