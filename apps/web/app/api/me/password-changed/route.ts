import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { writeAuditLog } from "@/lib/audit";

/**
 * POST /api/me/password-changed
 *
 * Atomic password-change-AND-clear-the-must-change-flag endpoint. Used by
 * the /change-password page when a user with `mustChangePassword=true`
 * picks a new password. The page calls THIS endpoint instead of Better
 * Auth's `changePassword` directly, so the password update and the flag
 * clear happen in a single server-side path — if changePassword fails the
 * flag stays set, if changePassword succeeds the flag is cleared in the
 * same request.
 *
 * Going through Better Auth's signed-in API ensures the same hashing /
 * validation / session-revocation behaviour the standard endpoint applies.
 *
 * Body: { currentPassword, newPassword, revokeOtherSessions? }
 */
type Body = {
  currentPassword?: string;
  newPassword?: string;
  revokeOtherSessions?: boolean;
};

export async function POST(request: Request) {
  const reqHeaders = await headers();

  // Same-origin enforcement. Modern browsers send Origin on every
  // state-changing request — a missing Origin is rejected. Referer is
  // accepted as a legacy fallback. See PR #100 for the same pattern on
  // /api/agent/[id]/route.ts.
  const host = reqHeaders.get("host");
  const origin = reqHeaders.get("origin");
  const referer = reqHeaders.get("referer");
  if (!isSameOrigin(host, origin, referer)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  if (
    typeof body.currentPassword !== "string" ||
    typeof body.newPassword !== "string"
  ) {
    return NextResponse.json(
      { error: "currentPassword and newPassword required" },
      { status: 400 },
    );
  }
  if (body.currentPassword === body.newPassword) {
    return NextResponse.json(
      { error: "New password must be different from the current one" },
      { status: 400 },
    );
  }

  try {
    await auth.api.changePassword({
      headers: reqHeaders,
      body: {
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        revokeOtherSessions: body.revokeOtherSessions ?? true,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: message || "Password change failed" },
      { status: 400 },
    );
  }

  // Clear the flag in the same request. Even if this update somehow fails
  // (extremely unlikely — the user row was just touched by changePassword),
  // the password is already updated. We treat the second update as
  // best-effort + log; on next request the layout will re-redirect to
  // /change-password but the user can supply the new password as
  // currentPassword and the flow will recover.
  await prisma.user
    .update({
      where: { id: session.user.id },
      data: { mustChangePassword: false },
    })
    .catch((err) => {
      console.error("[password-changed] failed to clear must-change flag:", err);
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

function isSameOrigin(
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
  if (referer) {
    try {
      return new URL(referer).host.toLowerCase() === expected;
    } catch {
      return false;
    }
  }
  // Missing both is suspicious for a state-changing request from a real
  // browser — reject. Matches PR #100's tightened policy.
  return false;
}
