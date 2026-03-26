import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { EmailNotificationSettings } from "./email-notification-settings";

export default async function NotificationsPage() {
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
      id: true,
      emailNotificationPreferences: {
        select: { eventType: true, enabled: true },
      },
    },
  });

  if (!member) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <EmailNotificationSettings
        preferences={member.emailNotificationPreferences}
        userEmail={session.user.email}
      />
    </div>
  );
}
