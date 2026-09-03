import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { generateApiToken, hashToken, getTokenPrefix } from "@/lib/api-auth";
import { getAccountStanding, ACCOUNT_HOLD_MESSAGE } from "@/lib/account-standing";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const deviceCode = typeof body?.deviceCode === "string" ? body.deviceCode.trim() : "";
  const organizationId = typeof body?.organizationId === "string" ? body.organizationId.trim() : "";

  if (!deviceCode || !organizationId) {
    return Response.json({ error: "Missing deviceCode or organizationId" }, { status: 400 });
  }

  if (!/^[0-9a-f]{40}$/.test(deviceCode)) {
    return Response.json({ error: "Invalid device code format" }, { status: 400 });
  }

  // Verify the auth session exists and is pending
  const authSession = await prisma.cliAuthSession.findUnique({
    where: { deviceCode },
  });

  if (!authSession || authSession.status !== "pending") {
    return Response.json({ error: "Invalid or already used device code" }, { status: 400 });
  }

  if (authSession.expiresAt < new Date()) {
    return Response.json({ error: "Device code expired" }, { status: 410 });
  }

  // Verify org membership
  const member = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      organizationId,
      deletedAt: null,
    },
  });
  if (!member) {
    return Response.json({ error: "Not a member of this organization" }, { status: 403 });
  }

  // Account-standing gate (issue #788): the signup farm minted its tokens
  // through this device flow — held accounts with no product signal get a
  // clear, actionable refusal instead of a token.
  const standing = await getAccountStanding({
    userId: session.user.id,
    orgId: organizationId,
  });
  if (standing.held) {
    return Response.json({ error: ACCOUNT_HOLD_MESSAGE }, { status: 403 });
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true },
  });
  if (!org) {
    return Response.json({ error: "Organization not found" }, { status: 404 });
  }

  // Create the API token
  const rawToken = generateApiToken();
  const tokenHash = hashToken(rawToken);
  const tokenPrefix = getTokenPrefix(rawToken);

  await prisma.orgApiToken.create({
    data: {
      name: `CLI (${session.user.name ?? session.user.email})`,
      tokenHash,
      tokenPrefix,
      organizationId,
      createdById: session.user.id,
    },
  });

  // Mark session as approved with the raw token
  await prisma.cliAuthSession.update({
    where: { id: authSession.id },
    data: {
      status: "approved",
      token: rawToken,
      orgId: org.id,
      orgSlug: org.slug,
      orgName: org.name,
      userName: session.user.name,
      userEmail: session.user.email,
    },
  });

  return Response.json({ success: true });
}
