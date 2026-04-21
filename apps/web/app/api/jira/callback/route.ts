import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@octopus/db";
import { getAccessibleResources } from "@/lib/jira";
import { encryptJson } from "@/lib/crypto";
import { writeAuditLog } from "@/lib/audit";

const PENDING_COOKIE = "jira_oauth_pending";
const PENDING_MAX_AGE_SECONDS = 5 * 60;

export async function GET(request: NextRequest) {
  const baseUrl = process.env.BETTER_AUTH_URL || request.url;
  const code = request.nextUrl.searchParams.get("code");
  const stateParam = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    console.error("[jira-callback] OAuth error:", error);
    return NextResponse.redirect(
      new URL("/settings/integrations?error=jira_denied", baseUrl),
    );
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=missing_params", baseUrl),
    );
  }

  let orgId: string;
  try {
    const parsed = JSON.parse(
      Buffer.from(stateParam, "base64url").toString("utf-8"),
    );
    orgId = parsed.orgId;
  } catch {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=invalid_state", baseUrl),
    );
  }

  const clientId = process.env.JIRA_CLIENT_ID!;
  const clientSecret = process.env.JIRA_CLIENT_SECRET!;
  const redirectUri = process.env.JIRA_REDIRECT_URI!;

  // Exchange code for tokens
  const tokenResponse = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text().catch(() => "");
    console.error("[jira-callback] Token exchange failed:", text);
    return NextResponse.redirect(
      new URL("/settings/integrations?error=token_exchange", baseUrl),
    );
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token;
  const expiresIn = tokenData.expires_in;

  if (!accessToken || !refreshToken || !expiresIn) {
    console.error("[jira-callback] Incomplete token payload");
    return NextResponse.redirect(
      new URL("/settings/integrations?error=token_exchange", baseUrl),
    );
  }

  // List accessible sites
  let sites: { cloudId: string; name: string; url: string }[];
  try {
    const resources = await getAccessibleResources(accessToken);
    sites = resources.map((r) => ({ cloudId: r.id, name: r.name, url: r.url }));
  } catch (err) {
    console.error("[jira-callback] Failed to list Jira sites:", err);
    return NextResponse.redirect(
      new URL("/settings/integrations?error=jira_api", baseUrl),
    );
  }

  if (sites.length === 0) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=jira_no_sites", baseUrl),
    );
  }

  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

  // Single site: finalize immediately.
  if (sites.length === 1) {
    const site = sites[0];
    const integration = await prisma.jiraIntegration.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        accessToken,
        refreshToken,
        tokenExpiresAt,
        cloudId: site.cloudId,
        siteUrl: site.url,
        siteName: site.name,
      },
      update: {
        accessToken,
        refreshToken,
        tokenExpiresAt,
        cloudId: site.cloudId,
        siteUrl: site.url,
        siteName: site.name,
      },
      select: { id: true },
    });

    await writeAuditLog({
      action: "integration.connected",
      category: "system",
      organizationId: orgId,
      targetType: "JiraIntegration",
      targetId: integration.id,
      metadata: { provider: "jira", siteName: site.name, cloudId: site.cloudId },
    });

    return NextResponse.redirect(
      new URL("/settings/integrations?success=jira", baseUrl),
    );
  }

  // Multiple sites: stash encrypted tokens in a short-lived cookie; redirect to site picker.
  const payload = encryptJson({
    orgId,
    accessToken,
    refreshToken,
    expiresAt: tokenExpiresAt.toISOString(),
    sites,
  });

  const cookieStore = await cookies();
  cookieStore.set(PENDING_COOKIE, payload, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PENDING_MAX_AGE_SECONDS,
  });

  return NextResponse.redirect(
    new URL("/settings/integrations/jira/select-site", baseUrl),
  );
}
