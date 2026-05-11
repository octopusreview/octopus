import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@octopus/db";
import { auth } from "@/lib/auth";
import { listWorkspaceRepos, createWebhook } from "@/lib/bitbucket";
import { encryptString } from "@/lib/crypto";

export async function GET(request: NextRequest) {
  const baseUrl = process.env.BETTER_AUTH_URL || request.url;
  const code = request.nextUrl.searchParams.get("code");
  const stateParam = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    console.error("[bitbucket-callback] OAuth error:", error);
    return NextResponse.redirect(
      new URL("/settings/integrations?error=bitbucket_denied", baseUrl),
    );
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=missing_params", baseUrl),
    );
  }

  // Verify the user is authenticated
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=unauthorized", baseUrl),
    );
  }

  let orgId: string;
  let stateNonce: string;
  let workspaceSlug: string;
  try {
    const parsed = JSON.parse(
      Buffer.from(stateParam, "base64url").toString("utf-8"),
    );
    orgId = parsed.orgId;
    stateNonce = parsed.nonce;
    workspaceSlug = parsed.workspaceSlug;
    if (!orgId || !stateNonce || !workspaceSlug) throw new Error("Missing state fields");
  } catch {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=invalid_state", baseUrl),
    );
  }

  // Verify the user is an admin/owner of this org
  const member = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id, organizationId: orgId, deletedAt: null },
    select: { role: true },
  });

  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=forbidden", baseUrl),
    );
  }

  // Validate environment variables
  const clientId = process.env.BITBUCKET_CLIENT_ID;
  const clientSecret = process.env.BITBUCKET_CLIENT_SECRET;
  const redirectUri = process.env.BITBUCKET_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    console.error("[bitbucket-callback] Missing Bitbucket OAuth environment variables");
    return NextResponse.redirect(
      new URL("/settings/integrations?error=not_configured", baseUrl),
    );
  }

  // Exchange code for tokens
  const tokenResponse = await fetch(
    "https://bitbucket.org/site/oauth2/access_token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    },
  );

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok || tokenData.error) {
    console.error("[bitbucket-callback] Token exchange failed:", tokenData);
    return NextResponse.redirect(
      new URL("/settings/integrations?error=token_exchange", baseUrl),
    );
  }

  const accessToken = tokenData.access_token as string | undefined;
  const refreshToken = tokenData.refresh_token as string | undefined;

  if (!accessToken || !refreshToken) {
    console.error("[bitbucket-callback] Missing tokens in response");
    return NextResponse.redirect(
      new URL("/settings/integrations?error=token_exchange", baseUrl),
    );
  }

  const expiresIn = (tokenData.expires_in as number) ?? 7200; // default 2 hours
  const scopes = (tokenData.scopes as string) ?? null;
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

  // Cross-workspace listing APIs were removed by Bitbucket (CHANGE-2770, April 2026).
  // Workspace slug is provided by the user before OAuth and passed via state.
  // Verify the workspace actually exists and the token has access to it.
  const workspaceRes = await fetch(
    `https://api.bitbucket.org/2.0/workspaces/${encodeURIComponent(workspaceSlug)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!workspaceRes.ok) {
    const errBody = await workspaceRes.text().catch(() => "");
    console.error("[bitbucket-callback] Workspace not found or inaccessible:", workspaceRes.status, errBody);
    return NextResponse.redirect(
      new URL("/settings/integrations?error=workspace_not_found", baseUrl),
    );
  }

  const workspaceData = await workspaceRes.json();
  const workspaceName = (workspaceData.name as string) || workspaceSlug;

  // Generate webhook secret
  const webhookSecret = crypto.randomBytes(32).toString("hex");

  // Debug log to surface on the UI
  const debugLog: string[] = [];
  debugLog.push(`workspace: ${workspaceSlug} (${workspaceName})`);

  // Upsert BitbucketIntegration (tokens encrypted at rest, see lib/crypto.ts)
  const accessTokenEnc = encryptString(accessToken);
  const refreshTokenEnc = encryptString(refreshToken);
  await prisma.bitbucketIntegration.upsert({
    where: { organizationId: orgId },
    create: {
      workspaceSlug,
      workspaceName,
      accessToken: accessTokenEnc,
      refreshToken: refreshTokenEnc,
      tokenExpiresAt,
      scopes,
      webhookSecret,
      organizationId: orgId,
    },
    update: {
      workspaceSlug,
      workspaceName,
      accessToken: accessTokenEnc,
      refreshToken: refreshTokenEnc,
      tokenExpiresAt,
      scopes,
      webhookSecret,
    },
  });
  debugLog.push("integration upserted OK");

  // Create workspace-level webhook (best-effort)
  const appUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
  const callbackUrl = `${appUrl}/api/bitbucket/webhook`;
  debugLog.push(`webhook target: ${callbackUrl}`);

  try {
    const webhookUuid = await createWebhook(orgId, workspaceSlug, callbackUrl, webhookSecret);
    if (webhookUuid) {
      await prisma.bitbucketIntegration.update({
        where: { organizationId: orgId },
        data: { webhookUuid },
      });
      debugLog.push(`webhook created OK (uuid: ${webhookUuid})`);
    } else {
      debugLog.push("webhook creation returned empty uuid");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    debugLog.push(`webhook creation FAILED: ${msg}`);
    console.error("[bitbucket-callback] Webhook creation failed:", err);
  }

  // Sync repos from workspace
  try {
    const bbRepos = await listWorkspaceRepos(orgId, workspaceSlug);
    for (const repo of bbRepos) {
      await prisma.repository.upsert({
        where: {
          provider_externalId_organizationId: {
            provider: "bitbucket",
            externalId: repo.uuid,
            organizationId: orgId,
          },
        },
        create: {
          name: repo.name,
          fullName: repo.full_name,
          externalId: repo.uuid,
          defaultBranch: repo.mainbranch?.name ?? "main",
          provider: "bitbucket",
          isActive: true,
          organizationId: orgId,
        },
        update: {
          name: repo.name,
          fullName: repo.full_name,
          defaultBranch: repo.mainbranch?.name ?? "main",
          isActive: true,
        },
      });
    }
    debugLog.push(`repos synced: ${bbRepos.length}`);
    console.log(`[bitbucket-callback] Synced ${bbRepos.length} repos for workspace ${workspaceSlug}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    debugLog.push(`repo sync FAILED: ${msg}`);
    console.error("[bitbucket-callback] Repo sync failed:", err);
  }

  const debugParam = encodeURIComponent(JSON.stringify(debugLog));
  return NextResponse.redirect(
    new URL(`/settings/integrations?success=bitbucket&bb_debug=${debugParam}`, baseUrl),
  );
}
