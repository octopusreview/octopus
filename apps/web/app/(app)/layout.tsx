import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { AppSidebar, MobileHeader } from "@/components/app-sidebar";
import { ChatWrapper } from "@/components/chat-wrapper";
import { PermissionBanner } from "@/components/permission-banner";
import { SpendLimitBanner } from "@/components/spend-limit-banner";
import { getInstallationPermissions } from "@/lib/github";
import { isAdminEmail } from "@/lib/admin";
import { getOrgSpendLimitStatus } from "@/lib/cost";
import { canUserCreateOrg } from "@/lib/org-limits";
import { OrgCookieSync } from "@/components/org-cookie-sync";
import { DeviceReporter } from "@/components/device-reporter";
import { createOrgForUser } from "./complete-profile/actions";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) redirect("/login");

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      bannedAt: true,
      onboardingCompleted: true,
      organizationMembers: {
        where: { deletedAt: null, organization: { deletedAt: null } },
        select: {
          organization: {
            select: {
              id: true,
              name: true,
              bannedAt: true,
              deletedAt: true,
              needsPermissionGrant: true,
              githubInstallationId: true,
            },
          },
        },
      },
    },
  });

  if (user.bannedAt) redirect("/blocked");

  const hasOrg = user.organizationMembers.length > 0;

  if (!hasOrg) {
    // Check for pending invitation first
    const pendingInvitation = await prisma.organizationInvitation.findFirst({
      where: {
        email: session.user.email,
        status: "pending",
        expiresAt: { gt: new Date() },
      },
      select: { token: true },
    });

    if (pendingInvitation) {
      redirect(`/invitation/${pendingInvitation.token}`);
    }

    const hasRealName = user.name && user.name.trim() !== "" && user.name !== user.email;

    if (hasRealName) {
      // Auto-create org server-side, then redirect so the next render picks it up.
      // We can't set cookies from a Server Component, but the layout's orgs[0]
      // fallback will select the new org on the next render.
      await createOrgForUser(session.user.id, user.name!);
      redirect("/dashboard");
    } else {
      // No name — show profile completion form
      const headersList = await headers();
      const pathname = headersList.get("x-pathname") || "";

      if (!pathname.startsWith("/complete-profile")) {
        redirect("/complete-profile");
      }

      return <>{children}</>;
    }
  }

  // Mark onboarding as completed if not already
  if (!user.onboardingCompleted) {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { onboardingCompleted: true },
    });
  }

  const orgs = user.organizationMembers
    .map((m) => m.organization)
    .filter((o) => !o.bannedAt && !o.deletedAt);
  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;

  // If the user's selected org was banned, check and redirect
  if (currentOrgId) {
    const selectedOrg = user.organizationMembers.find(
      (m) => m.organization.id === currentOrgId
    )?.organization;
    if (selectedOrg?.bannedAt) redirect("/blocked?reason=organization");
  }

  const currentOrg =
    orgs.find((o) => o.id === currentOrgId) ?? orgs[0] ?? { id: "", name: "Octopus" };

  const isAdmin = isAdminEmail(session.user.email);
  const canCreateOrg = await canUserCreateOrg(session.user.id);

  const sidebarProps = {
    user: { name: session.user.name, email: session.user.email },
    orgs,
    currentOrg,
    isAdmin,
    canCreateOrg,
  };

  const githubAppSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;

  // Check GitHub for orgs that need permission — auto-clear if already granted
  const flaggedOrgs = orgs.filter((o) => o.needsPermissionGrant && o.githubInstallationId);
  const orgsNeedingPermission: typeof flaggedOrgs = [];

  for (const org of flaggedOrgs) {
    try {
      const perms = await getInstallationPermissions(org.githubInstallationId!);
      if (perms.checks === "write") {
        // Permission granted — clear the flag
        await prisma.organization.update({
          where: { id: org.id },
          data: { needsPermissionGrant: false },
        });
      } else {
        orgsNeedingPermission.push(org);
      }
    } catch {
      // API call failed — keep showing the banner
      orgsNeedingPermission.push(org);
    }
  }

  // Check spend limit for current org (only if no own API key)
  const spendStatus = await getOrgSpendLimitStatus(currentOrg.id);

  return (
    <ChatWrapper orgId={currentOrg.id} userId={session.user.id} userName={session.user.name}>
      <OrgCookieSync orgId={currentOrg.id} />
      <DeviceReporter />
      <div className="flex h-screen flex-col">
        {orgsNeedingPermission.length > 0 && githubAppSlug && (
          <PermissionBanner
            githubAppSlug={githubAppSlug}
            orgs={orgsNeedingPermission.map((o) => ({ id: o.id, name: o.name }))}
          />
        )}
        <SpendLimitBanner spendStatus={spendStatus} />
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <AppSidebar {...sidebarProps} />
          <div className="flex min-h-0 flex-1 flex-col">
            <MobileHeader {...sidebarProps} />
            <main className="relative min-h-0 flex-1 overflow-y-scroll scrollbar-auto-hide">{children}</main>
          </div>
        </div>
      </div>
    </ChatWrapper>
  );
}
