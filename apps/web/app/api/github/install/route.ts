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
import { writeAuditLog } from "@/lib/audit";

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
    // No organization selected (cookie not set yet / cleared). Silent for the
    // user, but recorded so a dead Connect button is visible in the funnel.
    void writeAuditLog({
      action: "integration.install_failed",
      category: "system",
      actorId: session.user.id,
      actorEmail: session.user.email,
      metadata: { provider: "github", reason: "no_org_selected" },
    }).catch(() => {});
    return NextResponse.redirect(new URL("/dashboard", baseUrl));
  }

  const membership = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id, organizationId: orgId, deletedAt: null },
    select: { organizationId: true },
  });

  if (!membership) {
    void writeAuditLog({
      action: "integration.install_failed",
      category: "system",
      actorId: session.user.id,
      actorEmail: session.user.email,
      organizationId: orgId,
      metadata: { provider: "github", reason: "not_a_member" },
    }).catch(() => {});
    return NextResponse.redirect(new URL("/dashboard", baseUrl));
  }

  const returnTo = safeReturnPath(request.nextUrl.searchParams.get("returnTo"));

  // Funnel: signup → install started → connected (see /api/github/callback).
  // Fire-and-forget: telemetry must never block or fail the onboarding redirect
  // (Octopus review #762) — a transient audit-log error can't strand the user.
  void writeAuditLog({
    action: "integration.install_started",
    category: "system",
    actorId: session.user.id,
    actorEmail: session.user.email,
    organizationId: membership.organizationId,
    metadata: { provider: "github", returnTo },
  }).catch(() => {});

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
