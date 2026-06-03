import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { sendInvitationEmail } from "@/lib/invitation-email";
import {
  fixedWindowLimit,
  tooManyRequests,
  INVITE_USER_LIMIT,
  INVITE_USER_WINDOW_S,
  INVITE_ORG_LIMIT,
  INVITE_ORG_WINDOW_S,
} from "@/lib/rate-limit";

const INVITATION_EXPIRY_DAYS = 7;
const DAYS_TO_MS = 24 * 60 * 60 * 1000;

// POST /api/orgs/:orgId/invitations/:id/resend — Resend invitation
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId, id } = await params;

  const member = await prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId: session.user.id,
      role: { in: ["admin", "owner"] },
      deletedAt: null,
    },
  });
  if (!member) {
    return NextResponse.json({ error: "Forbidden: admin role required" }, { status: 403 });
  }

  const userLimit = await fixedWindowLimit(
    `invite:user:${session.user.id}`,
    INVITE_USER_LIMIT,
    INVITE_USER_WINDOW_S,
  );
  if (!userLimit.ok) {
    return tooManyRequests(
      "Too many invitations sent. Please wait a moment before inviting more people.",
      userLimit.retryAfterSeconds,
    );
  }

  // Resends also send an email, so they count against the same per-org daily
  // budget as new invitations — otherwise an admin could bypass the org cap by
  // repeatedly resending existing invitations.
  const orgLimit = await fixedWindowLimit(
    `invite:org:${orgId}`,
    INVITE_ORG_LIMIT,
    INVITE_ORG_WINDOW_S,
  );
  if (!orgLimit.ok) {
    return tooManyRequests(
      "This organization has reached its daily invitation limit. Please try again later.",
      orgLimit.retryAfterSeconds,
    );
  }

  const invitation = await prisma.organizationInvitation.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!invitation) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }

  if (invitation.status !== "pending" && invitation.status !== "expired") {
    return NextResponse.json({ error: "Can only resend pending or expired invitations" }, { status: 400 });
  }

  // Reset expiry and status
  const updated = await prisma.organizationInvitation.update({
    where: { id },
    data: {
      status: "pending",
      expiresAt: new Date(Date.now() + INVITATION_EXPIRY_DAYS * DAYS_TO_MS),
    },
  });

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });

  try {
    await sendInvitationEmail({
      email: invitation.email,
      token: updated.token,
      organizationName: org.name,
      inviterName: session.user.name || session.user.email,
      role: invitation.role,
    });
  } catch (err) {
    console.error("Failed to resend invitation email:", err);
  }

  return NextResponse.json({ invitation: updated });
}
