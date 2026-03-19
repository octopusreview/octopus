import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { InvitationsPanel } from "../invitations/invitations-panel";

export default async function TeamPage() {
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
      organizationId: true,
    },
  });

  if (!member) redirect("/dashboard");

  const isAdmin = member.role === "owner" || member.role === "admin";

  return <InvitationsPanel key={member.organizationId} orgId={member.organizationId} isAdmin={isAdmin} />;
}
