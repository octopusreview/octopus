import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { ApiKeysForm } from "../api-keys-form";

export default async function ApiKeysPage() {
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
          openaiApiKey: true,
          anthropicApiKey: true,
          googleApiKey: true,
          cohereApiKey: true,
        },
      },
    },
  });

  if (!member) redirect("/dashboard");

  const isOwner = member.role === "owner";

  return (
    <ApiKeysForm
      key={member.organization.id}
      openaiApiKey={member.organization.openaiApiKey}
      anthropicApiKey={member.organization.anthropicApiKey}
      googleApiKey={member.organization.googleApiKey}
      cohereApiKey={member.organization.cohereApiKey}
      isOwner={isOwner}
    />
  );
}
