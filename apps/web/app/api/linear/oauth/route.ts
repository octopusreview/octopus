import { NextResponse } from "next/server";
import { headers, cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import {
  createIntegrationOAuthState,
  integrationOAuthStateCookie,
  integrationOAuthStateCookieOptions,
} from "@/lib/integration-oauth-state";

export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) {
    return NextResponse.json({ error: "No organization selected" }, { status: 400 });
  }

  const member = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id, organizationId: orgId, deletedAt: null },
    select: { role: true },
  });

  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const clientId = process.env.LINEAR_CLIENT_ID;
  const redirectUri = process.env.LINEAR_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "Linear integration not configured" },
      { status: 500 },
    );
  }

  const { state, nonce } = createIntegrationOAuthState({
    provider: "linear",
    orgId,
    userId: session.user.id,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "read,write",
    state,
  });

  const response = NextResponse.redirect(
    `https://linear.app/oauth/authorize?${params.toString()}`,
  );
  response.cookies.set(
    integrationOAuthStateCookie("linear"),
    nonce,
    integrationOAuthStateCookieOptions(),
  );
  return response;
}
