import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { headers, cookies } from "next/headers";
import { prisma } from "@octopus/db";
import { auth } from "@/lib/auth";
import { listNamespaceProjects, createProjectWebhook } from "@/lib/gitlab";
import { decryptJson, encryptString } from "@/lib/crypto";

const GITLAB_OAUTH_INIT_COOKIE = "gitlab_oauth_init";
const COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

type InitPayload = {
  nonce: string;
  orgId: string;
  namespacePath: string;
  gitlabHost: string;
  clientId: string;
  clientSecret: string | null;
  issuedAt: number;
};

export async function GET(request: NextRequest) {
  const baseUrl = process.env.BETTER_AUTH_URL || request.url;
  const code = request.nextUrl.searchParams.get("code");
  const stateParam = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");

  const cookieStore = await cookies();
  const initCookieValue = cookieStore.get(GITLAB_OAUTH_INIT_COOKIE)?.value;
  // Always clear the init cookie — single-use even on error
  cookieStore.delete(GITLAB_OAUTH_INIT_COOKIE);

  if (error) {
    console.error("[gitlab-callback] OAuth error:", error);
    return NextResponse.redirect(
      new URL("/settings/integrations?error=gitlab_denied", baseUrl),
    );
  }

  if (!code || !stateParam || !initCookieValue) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=missing_params", baseUrl),
    );
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=unauthorized", baseUrl),
    );
  }

  let stateNonce: string;
  try {
    const parsed = JSON.parse(Buffer.from(stateParam, "base64url").toString("utf-8"));
    stateNonce = parsed.nonce;
    if (!stateNonce) throw new Error("Missing nonce");
  } catch {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=invalid_state", baseUrl),
    );
  }

  let init: InitPayload;
  try {
    init = decryptJson<InitPayload>(initCookieValue);
  } catch {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=invalid_init", baseUrl),
    );
  }

  if (init.nonce !== stateNonce) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=state_mismatch", baseUrl),
    );
  }
  if (Date.now() - init.issuedAt > COOKIE_MAX_AGE_MS) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=init_expired", baseUrl),
    );
  }

  const { orgId, namespacePath, gitlabHost, clientId, clientSecret } = init;

  const member = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id, organizationId: orgId, deletedAt: null },
    select: { role: true },
  });
  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=forbidden", baseUrl),
    );
  }

  // Resolve the secret used for the token exchange: prefer per-org from cookie,
  // else env default (gitlab.com cloud).
  const effectiveClientSecret = clientSecret ?? process.env.GITLAB_CLIENT_SECRET;
  const redirectUri = process.env.GITLAB_REDIRECT_URI;
  if (!effectiveClientSecret || !redirectUri) {
    console.error("[gitlab-callback] Missing GitLab OAuth secret or redirect URI");
    return NextResponse.redirect(
      new URL("/settings/integrations?error=not_configured", baseUrl),
    );
  }

  const tokenResponse = await fetch(`${gitlabHost}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: effectiveClientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || tokenData.error) {
    console.error("[gitlab-callback] Token exchange failed:", tokenData);
    return NextResponse.redirect(
      new URL("/settings/integrations?error=token_exchange", baseUrl),
    );
  }

  const accessToken = tokenData.access_token as string | undefined;
  const refreshToken = tokenData.refresh_token as string | undefined;
  if (!accessToken || !refreshToken) {
    console.error("[gitlab-callback] Missing tokens in response");
    return NextResponse.redirect(
      new URL("/settings/integrations?error=token_exchange", baseUrl),
    );
  }

  const expiresIn = (tokenData.expires_in as number) ?? 7200;
  const scopes = (tokenData.scope as string) ?? null;
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

  // Verify the namespace exists
  const apiBase = `${gitlabHost.replace(/\/+$/, "")}/api/v4`;
  let namespaceName: string;
  const groupRes = await fetch(
    `${apiBase}/groups/${encodeURIComponent(namespacePath)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (groupRes.ok) {
    const data = await groupRes.json();
    namespaceName = (data.name as string) || namespacePath;
  } else if (groupRes.status === 404) {
    const userRes = await fetch(
      `${apiBase}/users?username=${encodeURIComponent(namespacePath)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (userRes.ok) {
      const arr = (await userRes.json()) as Array<{ name?: string }>;
      namespaceName = arr[0]?.name ?? namespacePath;
    } else {
      console.error("[gitlab-callback] Namespace not found:", namespacePath);
      return NextResponse.redirect(
        new URL("/settings/integrations?error=namespace_not_found", baseUrl),
      );
    }
  } else {
    const body = await groupRes.text().catch(() => "");
    console.error("[gitlab-callback] Namespace lookup failed:", groupRes.status, body);
    return NextResponse.redirect(
      new URL("/settings/integrations?error=namespace_not_found", baseUrl),
    );
  }

  const webhookSecret = crypto.randomBytes(32).toString("hex");
  const debugLog: string[] = [];
  debugLog.push(`host: ${gitlabHost}`);
  debugLog.push(`namespace: ${namespacePath} (${namespaceName})`);
  if (clientSecret) debugLog.push("oauth: per-org credentials");

  // Persist OAuth creds (encrypted) only for self-hosted (non-env) flow,
  // so refresh can use them later.
  const persistOauthClientId = clientSecret ? clientId : null;
  const persistOauthClientSecretEnc = clientSecret ? encryptString(clientSecret) : null;
  const accessTokenEnc = encryptString(accessToken);
  const refreshTokenEnc = encryptString(refreshToken);

  await prisma.gitlabIntegration.upsert({
    where: { organizationId: orgId },
    create: {
      gitlabHost,
      namespacePath,
      namespaceName,
      oauthClientId: persistOauthClientId,
      oauthClientSecretEnc: persistOauthClientSecretEnc,
      accessToken: accessTokenEnc,
      refreshToken: refreshTokenEnc,
      tokenExpiresAt,
      scopes,
      webhookSecret,
      organizationId: orgId,
    },
    update: {
      gitlabHost,
      namespacePath,
      namespaceName,
      oauthClientId: persistOauthClientId,
      oauthClientSecretEnc: persistOauthClientSecretEnc,
      accessToken: accessTokenEnc,
      refreshToken: refreshTokenEnc,
      tokenExpiresAt,
      scopes,
      webhookSecret,
    },
  });
  debugLog.push("integration upserted OK");

  const appUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
  const callbackUrl = `${appUrl}/api/gitlab/webhook`;
  debugLog.push(`webhook target: ${callbackUrl}`);

  let projectCount = 0;
  let hookCount = 0;
  try {
    const projects = await listNamespaceProjects(orgId, namespacePath);
    projectCount = projects.length;
    for (const project of projects) {
      await prisma.repository.upsert({
        where: {
          provider_externalId_organizationId: {
            provider: "gitlab",
            externalId: String(project.id),
            organizationId: orgId,
          },
        },
        create: {
          name: project.name,
          fullName: project.path_with_namespace,
          externalId: String(project.id),
          defaultBranch: project.default_branch ?? "main",
          provider: "gitlab",
          isActive: true,
          organizationId: orgId,
        },
        update: {
          name: project.name,
          fullName: project.path_with_namespace,
          defaultBranch: project.default_branch ?? "main",
          isActive: true,
        },
      });

      try {
        const hookId = await createProjectWebhook(
          orgId,
          project.path_with_namespace,
          callbackUrl,
          webhookSecret,
        );
        if (hookId) hookCount += 1;
      } catch (err) {
        console.warn(`[gitlab-callback] Hook creation failed for ${project.path_with_namespace}:`, err);
      }
    }
    debugLog.push(`projects synced: ${projectCount}`);
    debugLog.push(`hooks created: ${hookCount}`);
    console.log(`[gitlab-callback] Synced ${projectCount} projects, ${hookCount} hooks for ${namespacePath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    debugLog.push(`project sync FAILED: ${msg}`);
    console.error("[gitlab-callback] Project sync failed:", err);
  }

  const debugParam = encodeURIComponent(JSON.stringify(debugLog));
  return NextResponse.redirect(
    new URL(`/settings/integrations?success=gitlab&gl_debug=${debugParam}`, baseUrl),
  );
}
