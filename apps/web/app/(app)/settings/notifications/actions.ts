"use server";

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";

async function requireSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");
  return session;
}

async function getCurrentMember() {
  const session = await requireSession();

  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) return null;

  const member = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      organizationId: orgId,
      deletedAt: null,
    },
    select: { id: true, organizationId: true },
  });

  return member;
}

export async function toggleEmailNotification(
  eventType: string,
  enabled: boolean,
): Promise<{ error?: string }> {
  const member = await getCurrentMember();
  if (!member) return { error: "Not a member of this organization." };

  await prisma.emailNotificationPreference.upsert({
    where: {
      memberId_eventType: {
        memberId: member.id,
        eventType,
      },
    },
    create: {
      eventType,
      enabled,
      memberId: member.id,
    },
    update: { enabled },
  });

  revalidatePath("/settings/notifications");
  return {};
}

export async function toggleAllEmailNotifications(
  enabled: boolean,
): Promise<{ error?: string }> {
  const member = await getCurrentMember();
  if (!member) return { error: "Not a member of this organization." };

  const eventTypes = [
    "review-requested",
    "review-completed",
    "review-failed",
    "repo-indexed",
    "repo-analyzed",
    "knowledge-ready",
  ];

  await Promise.all(
    eventTypes.map((eventType) =>
      prisma.emailNotificationPreference.upsert({
        where: {
          memberId_eventType: {
            memberId: member.id,
            eventType,
          },
        },
        create: {
          eventType,
          enabled,
          memberId: member.id,
        },
        update: { enabled },
      }),
    ),
  );

  revalidatePath("/settings/notifications");
  return {};
}

export async function toggleMarketingEmails(
  enabled: boolean,
): Promise<{ error?: string }> {
  const session = await requireSession();

  await prisma.user.update({
    where: { id: session.user.id },
    data: { marketingEmailsEnabled: enabled },
  });

  revalidatePath("/settings/notifications");
  return {};
}
