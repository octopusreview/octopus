import { headers } from "next/headers";
import { prisma } from "@octopus/db";
import { auth } from "@/lib/auth";

/**
 * Vendor (Octopus staff) super-admin identity for the cross-org telemetry
 * console. Identity is an ENV ALLOWLIST (OCTOPUS_SUPERADMIN_EMAILS, comma-sep)
 * — deliberately NOT a DB-settable flag, so there is no in-app way to escalate
 * to super-admin. A match additionally requires a verified email on the user
 * row resolved from the (immutable) session user id.
 */

export type SuperAdmin = { id: string; email: string };

function allowlist(): Set<string> {
  return new Set(
    (process.env.OCTOPUS_SUPERADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Resolve the current session to a super-admin, or null. Returns null when the
 * allowlist is empty (feature off), there's no session, the email isn't
 * verified, or the email isn't allowlisted. Never throws.
 */
export async function getSuperAdmin(): Promise<SuperAdmin | null> {
  const allow = allowlist();
  if (allow.size === 0) return null;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  // Resolve by the immutable session user id, then check the verified email
  // against the allowlist (email changes require re-verification in better-auth).
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, emailVerified: true },
  });
  if (!user || !user.emailVerified) return null;
  if (!allow.has(user.email.toLowerCase())) return null;

  return { id: user.id, email: user.email };
}
