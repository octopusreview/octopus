"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { isAdminEmail } from "@/lib/admin";
import { eventBus } from "@/lib/events/bus";

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not authenticated");
  if (!isAdminEmail(session.user.email)) throw new Error("Not authorized");
  return session;
}

export async function toggleUserBan(userId: string) {
  const session = await requireAdmin();

  const target = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, bannedAt: true },
  });

  // Prevent self-ban
  if (target.email === session.user.email) {
    return { error: "You cannot ban yourself." };
  }

  // Prevent banning other admins
  if (isAdminEmail(target.email)) {
    return { error: "You cannot ban another admin." };
  }

  if (target.bannedAt) {
    // Unban
    await prisma.user.update({
      where: { id: userId },
      data: { bannedAt: null, bannedReason: null },
    });
  } else {
    // Ban + delete all sessions to force logout
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { bannedAt: new Date() },
      }),
      prisma.session.deleteMany({
        where: { userId },
      }),
    ]);
  }

  revalidatePath("/admin");
  return { success: true };
}

export async function toggleOrgBan(orgId: string) {
  await requireAdmin();

  const target = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { bannedAt: true },
  });

  if (target.bannedAt) {
    await prisma.organization.update({
      where: { id: orgId },
      data: { bannedAt: null, bannedReason: null },
    });
  } else {
    await prisma.organization.update({
      where: { id: orgId },
      data: { bannedAt: new Date() },
    });
  }

  revalidatePath("/admin");
  return { success: true };
}

export async function changeOrgType(orgId: string, newType: number, reason?: string) {
  const session = await requireAdmin();

  if (![1, 2, 3].includes(newType)) {
    return { error: "Invalid type" };
  }

  const target = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { type: true, name: true },
  });

  if (target.type === newType) {
    return { error: "Already this type" };
  }

  await prisma.$transaction([
    prisma.orgTypeChange.create({
      data: {
        organizationId: orgId,
        fromType: target.type,
        toType: newType,
        reason: reason || null,
        changedById: session.user.id,
      },
    }),
    prisma.organization.update({
      where: { id: orgId },
      data: { type: newType },
    }),
  ]);

  eventBus.emit({
    type: "org-type-changed",
    orgId,
    orgName: target.name,
    fromType: target.type,
    toType: newType,
    reason,
    changedById: session.user.id,
    changedByEmail: session.user.email,
  });

  revalidatePath("/admin");
  return { success: true };
}
