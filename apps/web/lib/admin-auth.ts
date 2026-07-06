import "server-only";
import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

/**
 * Shared machine auth for the /api/admin/* endpoints consumed by the
 * octopus-configuration console: the ADMIN_API_SECRET bearer, compared in
 * CONSTANT TIME. Fails closed when the secret is unset (e.g. self-host), so
 * these vendor endpoints are inert there.
 */
export function isAdminApiAuthorized(request: NextRequest): boolean {
  const expected = process.env.ADMIN_API_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization");
  if (!header) return false;
  const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch; the length check leaks only
  // length, not content — standard for bearer comparison.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
