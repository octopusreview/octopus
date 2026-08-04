import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import {
  GITHUB_INSTALL_STATE_COOKIE,
  GITHUB_INSTALL_STATE_TTL_MS,
  safeReturnPath,
  signInstallState,
} from "@/lib/github-install-state";
import { getGithubAppConfig } from "@/lib/github-app-config";

const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";

export async function GET(request: NextRequest) {
  const appSlug = (await getGithubAppConfig())?.slug;
  if (!appSlug) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=github_app_not_configured", baseUrl),
    );
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    const resume = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${encodeURIComponent(resume)}`, baseUrl),
    );
  }

  const cookieStore = await cookies();
  const requestedOrgId = request.nextUrl.searchParams.get("orgId");
  const orgId = requestedOrgId || cookieStore.get("current_org_id")?.value;

  if (!orgId) {
    return NextResponse.redirect(new URL("/dashboard", baseUrl));
  }

  const membership = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id, organizationId: orgId, deletedAt: null },
    select: { organizationId: true },
  });

  if (!membership) {
    return NextResponse.redirect(new URL("/dashboard", baseUrl));
  }

  const returnTo = safeReturnPath(request.nextUrl.searchParams.get("returnTo"));

  const nonce = crypto.randomBytes(16).toString("base64url");
  const state = signInstallState({
    uid: session.user.id,
    oid: membership.organizationId,
    rt: returnTo,
    nonce,
  });

  const installUrl = new URL(`https://github.com/apps/${appSlug}/installations/new`);
  installUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(installUrl.toString());
  response.cookies.set(GITHUB_INSTALL_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: baseUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/api/github/callback",
    maxAge: Math.floor(GITHUB_INSTALL_STATE_TTL_MS / 1000),
  });
  return response;
}
