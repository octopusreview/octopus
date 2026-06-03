import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { sendInvitationEmail } from "@/lib/invitation-email";
import { normalizeEmail } from "@/lib/email-normalize";
import { validateEmailForSignup, reasonToMessage } from "@/lib/email-validator";
import {
  fixedWindowLimit,
  tooManyRequests,
  INVITE_USER_LIMIT,
  INVITE_USER_WINDOW_S,
  INVITE_ORG_LIMIT,
  INVITE_ORG_WINDOW_S,
  INVITE_ORG_PENDING_CAP,
} from "@/lib/rate-limit";

const INVITATION_EXPIRY_DAYS = 7;
const DAYS_TO_MS = 24 * 60 * 60 * 1000;
const VALID_ROLES = ["admin", "member"];

async function getAdminMember(orgId: string, userId: string) {
  return prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId,
      role: { in: ["admin", "owner"] },
      deletedAt: null,
    },
  });
}

// POST /api/orgs/:orgId/invitations — Send invitation
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId } = await params;

  const member = await getAdminMember(orgId, session.user.id);
  if (!member) {
    return NextResponse.json({ error: "Forbidden: admin role required" }, { status: 403 });
  }

  // Per-inviter burst limit (shared with resend). Catches scripted firing.
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

  // Per-org sustained limit. Guards against a single org spraying invitations.
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

  const body = await request.json();
  const { email: rawEmail, role } = body;

  if (!rawEmail || typeof rawEmail !== "string") {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const email = normalizeEmail(rawEmail);

  // Validate the recipient address before sending. Invitations go out via AWS
  // SES, so blocking disposable domains and addresses with no valid MX record
  // (the same checks the signup flow runs) protects sender reputation.
  const emailValidation = await validateEmailForSignup(email);
  if (!emailValidation.ok) {
    return NextResponse.json({ error: reasonToMessage(emailValidation.reason) }, { status: 400 });
  }

  if (role && !VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` }, { status: 400 });
  }

  const assignedRole = role || "member";

  // Check if user is already an active member
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const existingMember = await prisma.organizationMember.findFirst({
      where: {
        organizationId: orgId,
        userId: existingUser.id,
        deletedAt: null,
      },
    });
    if (existingMember) {
      return NextResponse.json({ error: "User is already a member of this organization" }, { status: 409 });
    }
  }

  // Check for existing pending invitation
  const existingInvitation = await prisma.organizationInvitation.findFirst({
    where: { organizationId: orgId, email, status: "pending" },
  });
  if (existingInvitation) {
    return NextResponse.json({ error: "A pending invitation already exists for this email" }, { status: 409 });
  }

  // Hard cap on outstanding pending invitations per org.
  const pendingCount = await prisma.organizationInvitation.count({
    where: { organizationId: orgId, status: "pending" },
  });
  if (pendingCount >= INVITE_ORG_PENDING_CAP) {
    return NextResponse.json(
      { error: "Too many pending invitations. Revoke some before sending more." },
      { status: 409 },
    );
  }

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });

  const invitation = await prisma.organizationInvitation.create({
    data: {
      email,
      role: assignedRole,
      organizationId: orgId,
      invitedById: session.user.id,
      expiresAt: new Date(Date.now() + INVITATION_EXPIRY_DAYS * DAYS_TO_MS),
    },
  });

  // Send email to the raw (typed) address — deliverability equivalent for Gmail
  let emailSent = false;
  try {
    await sendInvitationEmail({
      email: rawEmail,
      token: invitation.token,
      organizationName: org.name,
      inviterName: session.user.name || session.user.email,
      role: assignedRole,
    });
    emailSent = true;
  } catch (err) {
    console.error("Failed to send invitation email:", err);
  }

  return NextResponse.json({
    invitation,
    emailSent,
    message: emailSent ? "Invitation sent" : "Invitation created but email failed to send",
  }, { status: 201 });
}

// GET /api/orgs/:orgId/invitations — List invitations
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId } = await params;

  const member = await prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId: session.user.id,
      deletedAt: null,
    },
  });
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");

  const invitations = await prisma.organizationInvitation.findMany({
    where: {
      organizationId: orgId,
      ...(status ? { status } : {}),
    },
    include: {
      invitedBy: { select: { id: true, name: true, email: true, image: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ invitations });
}
