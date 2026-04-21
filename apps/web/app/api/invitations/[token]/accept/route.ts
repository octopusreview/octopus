import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { normalizeEmail } from "@/lib/email-normalize";

const APP_URL = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// POST /api/invitations/:token/accept — Accept invitation
// Also supports GET for email link click (redirects to login if not authenticated)
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  return handleAccept(await params);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Check session — if not logged in, redirect to login with return URL
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    const returnUrl = encodeURIComponent(`/api/invitations/${token}/accept`);
    return NextResponse.redirect(`${APP_URL}/login?callbackUrl=${returnUrl}`);
  }

  const result = await handleAccept({ token }, session.user.id);
  if (result.ok) {
    return NextResponse.redirect(`${APP_URL}/dashboard`);
  }
  // On error, redirect with error message
  const body = await result.json();
  return NextResponse.redirect(`${APP_URL}/login?error=${encodeURIComponent(body.error)}`);
}

async function handleAccept(
  { token }: { token: string },
  userIdOverride?: string
): Promise<NextResponse> {
  let userId = userIdOverride;

  if (!userId) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    userId = session.user.id;
  }

  const invitation = await prisma.organizationInvitation.findUnique({
    where: { token },
  });

  if (!invitation) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }

  if (invitation.status !== "pending") {
    return NextResponse.json({ error: `Invitation has already been ${invitation.status}` }, { status: 400 });
  }

  if (new Date() > invitation.expiresAt) {
    await prisma.organizationInvitation.update({
      where: { id: invitation.id },
      data: { status: "expired" },
    });
    return NextResponse.json({ error: "Invitation has expired" }, { status: 410 });
  }

  // Verify the accepting user's email matches the invitation email
  const acceptingUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  if (
    !acceptingUser ||
    normalizeEmail(acceptingUser.email) !== normalizeEmail(invitation.email)
  ) {
    return NextResponse.json(
      { error: "This invitation was sent to a different email address. Please sign in with the invited email." },
      { status: 403 }
    );
  }

  // Check if already an active member
  const existingMember = await prisma.organizationMember.findFirst({
    where: {
      organizationId: invitation.organizationId,
      userId,
      deletedAt: null,
    },
  });

  if (existingMember) {
    // Mark invitation as accepted anyway
    await prisma.organizationInvitation.update({
      where: { id: invitation.id },
      data: { status: "accepted" },
    });
    return NextResponse.json({ message: "Already a member of this organization" });
  }

  // Upsert membership (reactivates soft-deleted record if exists), mark invitation as accepted, and complete onboarding
  await prisma.$transaction([
    prisma.organizationMember.upsert({
      where: {
        organizationId_userId: {
          organizationId: invitation.organizationId,
          userId,
        },
      },
      create: {
        organizationId: invitation.organizationId,
        userId,
        role: invitation.role,
      },
      update: {
        role: invitation.role,
        deletedAt: null,
        removedById: null,
      },
    }),
    prisma.organizationInvitation.update({
      where: { id: invitation.id },
      data: { status: "accepted" },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { onboardingCompleted: true, onboardingStep: 8 },
    }),
  ]);

  return NextResponse.json({ message: "Invitation accepted" });
}
