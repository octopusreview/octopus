import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { signInstallState } from "@/lib/github-install-state";

const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";

function safeRelativePath(value: string | null | undefined): string {
  if (!value) return "/settings/integrations";
  if (!value.startsWith("/") || value.startsWith("//")) return "/settings/integrations";
  return value;
}

export async function GET(request: NextRequest) {
  const appSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
  if (!appSlug) {
    return NextResponse.json({ error: "github_app_not_configured" }, { status: 500 });
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.redirect(new URL("/login", baseUrl));
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

  const returnTo = safeRelativePath(request.nextUrl.searchParams.get("returnTo"));

  const state = signInstallState({
    uid: session.user.id,
    oid: membership.organizationId,
    rt: returnTo,
  });

  const installUrl = new URL(`https://github.com/apps/${appSlug}/installations/new`);
  installUrl.searchParams.set("state", state);

  return NextResponse.redirect(installUrl.toString());
}
