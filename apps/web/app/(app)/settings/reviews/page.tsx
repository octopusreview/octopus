import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { ReviewSettingsForm } from "./review-settings-form";
import { ReviewsPausedSwitch } from "./reviews-paused-switch";
import { OrgReviewConfigForm } from "./org-review-config-form";

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
        },
      },
    },
  });

  if (!member) redirect("/dashboard");

  const orgReviewConfig = (member.organization.defaultReviewConfig as Record<string, unknown>) ?? {};

  return (
    <div key={member.organization.id} className="space-y-6">
      <ReviewsPausedSwitch
        isOwner={member.role === "owner"}
        paused={member.organization.reviewsPaused}
      />
      <ReviewSettingsForm
        isOwner={member.role === "owner"}
        currentThreshold={member.organization.checkFailureThreshold}
      />
      <OrgReviewConfigForm
        isOwner={member.role === "owner"}
        initialConfig={orgReviewConfig}
      />
    </div>
  );
}
