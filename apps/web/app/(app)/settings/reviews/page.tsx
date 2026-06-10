import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { ReviewSettingsForm } from "./review-settings-form";
import { ReviewsPausedSwitch } from "./reviews-paused-switch";
import { OrgReviewConfigForm } from "./org-review-config-form";
import { ReviewLanguageForm } from "./review-language-form";
import { BlockedAuthorsForm } from "./blocked-authors-form";

export default async function ReviewsSettingsPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;

  const member = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      ...(currentOrgId ? { organizationId: currentOrgId } : {}),
      deletedAt: null,
    },
    select: {
      role: true,
      organization: {
        select: {
          id: true,
          checkFailureThreshold: true,
          reviewsPaused: true,
          defaultReviewConfig: true,
          reviewLanguage: true,
          blockedAuthors: true,
        },
      },
    },
  });

  if (!member) redirect("/dashboard");

  const orgReviewConfig = (member.organization.defaultReviewConfig as Record<string, unknown>) ?? {};
  const orgBlockedAuthors = (member.organization.blockedAuthors as string[]) ?? [];

  const globalConfig = await prisma.systemConfig.findUnique({
    where: { id: "singleton" },
    select: { blockedAuthors: true },
  });
  const globalBlockedAuthors = (globalConfig?.blockedAuthors as string[]) ?? [];

  const canManage = member.role === "owner" || member.role === "admin";

  return (
    <div key={member.organization.id} className="space-y-6">
      <ReviewsPausedSwitch
        isOwner={canManage}
        paused={member.organization.reviewsPaused}
      />
      <ReviewSettingsForm
        isOwner={canManage}
        currentThreshold={member.organization.checkFailureThreshold}
      />
      <OrgReviewConfigForm
        isOwner={canManage}
        initialConfig={orgReviewConfig}
      />
      <ReviewLanguageForm
        isOwner={canManage}
        initialLanguage={member.organization.reviewLanguage ?? "en"}
      />
      <BlockedAuthorsForm
        isOwner={canManage}
        initialAuthors={orgBlockedAuthors}
        globalAuthors={globalBlockedAuthors}
      />
    </div>
  );
}
