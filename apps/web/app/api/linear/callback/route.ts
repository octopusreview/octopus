import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { getLinearViewer } from "@/lib/linear";
import { writeAuditLog } from "@/lib/audit";
import { encryptString } from "@/lib/crypto";
import {
  integrationOAuthStateCookie,
  verifyIntegrationOAuthState,
} from "@/lib/integration-oauth-state";

export async function GET(request: NextRequest) {
  const baseUrl = process.env.BETTER_AUTH_URL || request.url;
  const code = request.nextUrl.searchParams.get("code");
  const stateParam = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");
  const cookieStore = await cookies();
  const stateCookie = integrationOAuthStateCookie("linear");
  const cookieNonce = cookieStore.get(stateCookie)?.value;
  cookieStore.delete(stateCookie);

  if (error) {
    console.error("[linear-callback] OAuth error:", error);
    return NextResponse.redirect(
      new URL("/settings/integrations?error=linear_denied", baseUrl),
    );
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=missing_params", baseUrl),
    );
  }

  const verified = verifyIntegrationOAuthState({
    state: stateParam,
    cookieNonce,
    provider: "linear",
  });
  if (!verified.ok) {
    return NextResponse.redirect(
      new URL(`/settings/integrations?error=${verified.error}`, baseUrl),
    );
  }
  const { orgId, userId } = verified.state;

  // Verify the authenticated user is an admin of the org referenced in state
  // to prevent a crafted callback from binding attacker tokens to a victim org.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.redirect(new URL("/login", baseUrl));
  }
  if (session.user.id !== userId) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=forbidden", baseUrl),
    );
  }
  const member = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id, organizationId: orgId, deletedAt: null },
    select: { role: true },
  });
  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=insufficient_role", baseUrl),
    );
  }

  const clientId = process.env.LINEAR_CLIENT_ID!;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET!;
  const redirectUri = process.env.LINEAR_REDIRECT_URI!;

  // Exchange code for token
  const tokenResponse = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text().catch(() => "");
    console.error("[linear-callback] Token exchange failed:", text);
    return NextResponse.redirect(
      new URL("/settings/integrations?error=token_exchange", baseUrl),
    );
  }

  const tokenData = await tokenResponse.json();
  const accessToken = tokenData.access_token;

  if (!accessToken) {
    console.error("[linear-callback] No access token in response");
    return NextResponse.redirect(
      new URL("/settings/integrations?error=token_exchange", baseUrl),
    );
  }

  // Fetch workspace info
  let workspaceId: string;
  let workspaceName: string;
  try {
    const viewer = await getLinearViewer(accessToken);
    workspaceId = viewer.organization.id;
    workspaceName = viewer.organization.name;
  } catch (err) {
    console.error("[linear-callback] Failed to fetch Linear viewer:", err);
    return NextResponse.redirect(
      new URL("/settings/integrations?error=linear_api", baseUrl),
    );
  }

  // Upsert LinearIntegration (token encrypted at rest)
  const accessTokenEnc = encryptString(accessToken);
  const integration = await prisma.linearIntegration.upsert({
    where: { organizationId: orgId },
    create: {
      organizationId: orgId,
      accessToken: accessTokenEnc,
      workspaceId,
      workspaceName,
    },
    update: {
      accessToken: accessTokenEnc,
      workspaceId,
      workspaceName,
    },
  });

  await writeAuditLog({
    action: "integration.connected",
    category: "system",
    organizationId: orgId,
    targetType: "LinearIntegration",
    targetId: integration.id,
    metadata: { provider: "linear", workspaceId, workspaceName },
  });

  return NextResponse.redirect(
    new URL("/settings/integrations?success=linear", baseUrl),
  );
}
