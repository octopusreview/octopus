import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { listInstallationRepos } from "@/lib/github";

const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";

export async function GET(request: NextRequest) {
  const installationId = request.nextUrl.searchParams.get("installation_id");
  let stateParam = request.nextUrl.searchParams.get("state");
  console.log("[github/callback] installationId:", installationId, "state:", stateParam);

  // Extract org ID from state if present (format: "orgId|returnUrl")
  let targetOrgId: string | null = null;
  if (stateParam?.includes("|")) {
    const pipeIndex = stateParam.indexOf("|");
    targetOrgId = stateParam.substring(0, pipeIndex);
    stateParam = stateParam.substring(pipeIndex + 1);
  }

  // If state contains a full URL origin, forward the callback to that origin
  if (stateParam?.startsWith("http")) {
    try {
      const stateUrl = new URL(stateParam);
      const stateOrigin = stateUrl.origin;
      if (stateOrigin !== new URL(baseUrl).origin) {
        const forwardUrl = new URL("/api/github/callback", stateOrigin);
        forwardUrl.searchParams.set("installation_id", installationId || "");
        // Re-encode orgId in forwarded state so the target origin can use it
        const forwardedState = targetOrgId
          ? `${targetOrgId}|${stateUrl.pathname + stateUrl.search}`
          : stateUrl.pathname + stateUrl.search;
        forwardUrl.searchParams.set("state", forwardedState);
        if (request.nextUrl.searchParams.get("setup_action")) {
          forwardUrl.searchParams.set("setup_action", request.nextUrl.searchParams.get("setup_action")!);
        }
        console.log("[github/callback] forwarding to origin:", forwardUrl.toString());
        return NextResponse.redirect(forwardUrl.toString());
      }
      // Same origin — strip origin from state, continue with path only
      stateParam = stateUrl.pathname + stateUrl.search;
    } catch {
      // Invalid URL in state, continue normally
    }
  }

  if (!installationId) {
    console.log("[github/callback] no installationId, redirecting to /dashboard");
    return NextResponse.redirect(new URL("/dashboard", baseUrl));
  }

  const session = await auth.api.getSession({
    headers: await headers(),
  });
  console.log("[github/callback] session:", session?.user?.id ?? "null");

  if (!session) {
    return NextResponse.redirect(new URL("/login", baseUrl));
  }

  // Use org ID from state param (reliable, set at flow start) or fall back to cookie
  const cookieStore = await cookies();
  const currentOrgId = targetOrgId || cookieStore.get("current_org_id")?.value;

  const membership = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      ...(currentOrgId ? { organizationId: currentOrgId } : {}),
      deletedAt: null,
    },
    select: { organizationId: true },
  });
  console.log("[github/callback] targetOrgId:", targetOrgId, "cookieOrgId:", cookieStore.get("current_org_id")?.value, "resolved:", membership?.organizationId ?? "null");

  if (!membership) {
    return NextResponse.redirect(new URL("/dashboard", baseUrl));
  }

  const installationIdNum = parseInt(installationId, 10);

  // Clear this installation from any other org, then save to current org
  await prisma.$transaction([
    prisma.organization.updateMany({
      where: { githubInstallationId: installationIdNum },
      data: { githubInstallationId: null },
    }),
    prisma.organization.update({
      where: { id: membership.organizationId },
      data: { githubInstallationId: installationIdNum },
    }),
  ]);
  console.log("[github/callback] saved installationId:", installationIdNum);

  // Sync repos from the installation
  try {
    const ghRepos = await listInstallationRepos(installationIdNum);
    console.log("[github/callback] fetched repos:", ghRepos.length);
    for (const repo of ghRepos) {
      await prisma.repository.upsert({
        where: {
          provider_externalId: {
            provider: "github",
            externalId: String(repo.id),
          },
        },
        create: {
          name: repo.name,
          fullName: repo.full_name,
          externalId: String(repo.id),
          defaultBranch: repo.default_branch,
          provider: "github",
          installationId: installationIdNum,
          organizationId: membership.organizationId,
        },
        update: {
          name: repo.name,
          fullName: repo.full_name,
          defaultBranch: repo.default_branch,
          installationId: installationIdNum,
          isActive: true,
          organizationId: membership.organizationId,
        },
      });
    }
    console.log("[github/callback] repos synced successfully");
  } catch (err) {
    console.error("[github/callback] repo sync error:", err);
  }

  revalidatePath("/", "layout");
  revalidatePath("/");
  const redirectTo = stateParam && stateParam.startsWith("/") && !stateParam.startsWith("//") ? stateParam : "/dashboard";
  console.log("[github/callback] redirecting to", redirectTo);
  return NextResponse.redirect(new URL(redirectTo, baseUrl));
}
