import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { writeAuditLog } from "@/lib/audit";

/**
 * POST /api/me/password-changed
 *
 * Clears the `mustChangePassword` flag on the signed-in user's row.
 * Called by /change-password after Better Auth's changePassword succeeds.
 *
 * Idempotent — safe to retry. Logged as `auth.must_change_password_cleared`
 * so the audit trail shows who completed the forced change and when.
 */
export async function POST() {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Same-origin guard — this endpoint is only intended to be hit by the
  // change-password page, not by anything cross-origin.
  const host = reqHeaders.get("host");
  const origin = reqHeaders.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host.toLowerCase() !== (host ?? "").toLowerCase()) {
        return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
    }
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { mustChangePassword: false },
  });

  await writeAuditLog({
    action: "auth.must_change_password_cleared",
    category: "auth",
    actorId: session.user.id,
    actorEmail: session.user.email,
    targetType: "user",
    targetId: session.user.id,
    ipAddress: reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: reqHeaders.get("user-agent") ?? null,
  }).catch((err) => {
    console.error("[password-changed] audit log failed:", err);
  });

  return NextResponse.json({ ok: true });
}
