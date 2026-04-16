import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { UserNameForm } from "./user-name-form";
import { OrgNameForm } from "./org-name-form";
import { DangerZoneCard } from "./danger-zone-card";

export default async function SettingsPage() {
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
        select: { id: true, name: true, slug: true, avatarUrl: true },
      },
    },
  });

  if (!member) redirect("/dashboard");

  const isOwner = member.role === "owner";

  let isLastOrg = false;
  if (isOwner) {
    const activeOrgCount = await prisma.organizationMember.count({
      where: {
        userId: session.user.id,
        deletedAt: null,
        organization: { deletedAt: null, bannedAt: null },
      },
    });
    isLastOrg = activeOrgCount <= 1;
  }

  return (
    <div key={member.organization.id} className="space-y-6">
      <UserNameForm currentName={session.user.name ?? ""} />
      <OrgNameForm
        currentName={member.organization.name}
        avatarUrl={member.organization.avatarUrl}
        isOwner={isOwner}
      />
      {isOwner && <DangerZoneCard orgSlug={member.organization.slug} isLastOrg={isLastOrg} />}
    </div>
  );
}
