import { NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { authenticateApiToken } from "@/lib/api-auth";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("orgId");

  if (!orgId) {
    return NextResponse.json({ error: "orgId is required" }, { status: 400 });
  }

  // Support both browser session auth and API token auth
  let authorized = false;

  const apiAuth = await authenticateApiToken(request);
  if (apiAuth && apiAuth.org.id === orgId) {
    authorized = true;
  }

  if (!authorized) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session) {
      const member = await prisma.organizationMember.findFirst({
        where: {
          userId: session.user.id,
          organizationId: orgId,
          deletedAt: null,
        },
      });
      if (member) {
        authorized = true;
      }
    }
  }

  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const staleThreshold = new Date(Date.now() - 90_000); // 90s

  const agents = await prisma.localAgent.findMany({
    where: {
      organizationId: orgId,
      status: "online",
      lastSeenAt: { gte: staleThreshold },
    },
    select: {
      id: true,
      name: true,
      repoFullNames: true,
      capabilities: true,
      lastSeenAt: true,
    },
  });

  return NextResponse.json({ agents });
}
