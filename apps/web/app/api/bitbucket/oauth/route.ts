import { NextResponse } from "next/server";
import { headers, cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import {
  createIntegrationOAuthState,
  integrationOAuthStateCookie,
  integrationOAuthStateCookieOptions,
} from "@/lib/integration-oauth-state";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const workspaceSlug = searchParams.get("workspace")?.toLowerCase().trim();

  if (!workspaceSlug) {
    return NextResponse.json({ error: "Workspace slug is required" }, { status: 400 });
  }

  if (!/^[a-z0-9][a-z0-9_-]*$/.test(workspaceSlug) || workspaceSlug.length > 100) {
    return NextResponse.json({ error: "Invalid workspace slug format" }, { status: 400 });
  }

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

  const clientId = process.env.BITBUCKET_CLIENT_ID;
  const redirectUri = process.env.BITBUCKET_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "Bitbucket integration not configured" },
      { status: 500 },
    );
  }

  const { state, nonce } = createIntegrationOAuthState({
    provider: "bitbucket",
    orgId,
    userId: session.user.id,
    context: { workspaceSlug },
  });

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    state,
    scope: "account repository pullrequest webhook",
  });

  const response = NextResponse.redirect(
    `https://bitbucket.org/site/oauth2/authorize?${params.toString()}`,
  );
  response.cookies.set(
    integrationOAuthStateCookie("bitbucket"),
    nonce,
    integrationOAuthStateCookieOptions(),
  );
  return response;
}
