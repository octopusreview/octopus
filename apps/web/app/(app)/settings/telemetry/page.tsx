import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { canUseLiveTelemetry } from "@/lib/entitlements";
import { LiveTelemetrySwitch } from "./live-telemetry-switch";

export default async function TelemetrySettingsPage() {
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
          liveTelemetryEnabled: true,
        },
      },
    },
  });

  if (!member) redirect("/dashboard");

  const canManage = member.role === "owner" || member.role === "admin";
  const paid = await canUseLiveTelemetry(member.organization.id);

  return (
    <div key={member.organization.id} className="space-y-6">
      <LiveTelemetrySwitch
        canManage={canManage}
        enabled={member.organization.liveTelemetryEnabled}
        paid={paid}
      />
    </div>
  );
}
