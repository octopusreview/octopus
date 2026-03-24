"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { prisma } from "@octopus/db";
import { revalidatePath } from "next/cache";

export async function approveRequest(requestId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdminEmail(session.user.email)) {
    return { error: "Unauthorized" };
  }

  const request = await prisma.safePackageRequest.findUnique({ where: { id: requestId } });
  if (!request || request.status !== "pending") {
    return { error: "Request not found or already reviewed" };
  }

  // Atomically add to safe packages and update request status
  await prisma.$transaction([
    prisma.safePackage.upsert({
      where: { name: request.name },
      create: {
        name: request.name,
        reason: request.reason,
        approvedBy: session.user.id,
      },
      update: {
        reason: request.reason,
        approvedBy: session.user.id,
      },
    }),
    prisma.safePackageRequest.update({
      where: { id: requestId },
      data: { status: "approved", reviewedBy: session.user.id, reviewedAt: new Date() },
    }),
  ]);

  revalidatePath("/admin/safe-packages");
  return { success: true };
}

export async function rejectRequest(requestId: string, reviewNote?: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdminEmail(session.user.email)) {
    return { error: "Unauthorized" };
  }

  await prisma.safePackageRequest.update({
    where: { id: requestId },
    data: {
      status: "rejected",
      reviewedBy: session.user.id,
      reviewedAt: new Date(),
      reviewNote: reviewNote ?? null,
    },
  });

  revalidatePath("/admin/safe-packages");
  return { success: true };
}

export async function addSafePackage(name: string, reason: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdminEmail(session.user.email)) {
    return { error: "Unauthorized" };
  }

  await prisma.safePackage.upsert({
    where: { name },
    create: { name, reason, approvedBy: session.user.id },
    update: { reason, approvedBy: session.user.id },
  });

  revalidatePath("/admin/safe-packages");
  return { success: true };
}

export async function removeSafePackage(id: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdminEmail(session.user.email)) {
    return { error: "Unauthorized" };
  }

  await prisma.safePackage.delete({ where: { id } });

  revalidatePath("/admin/safe-packages");
  return { success: true };
}

/** Seed popular packages from JSON into DB */
export async function seedPopularPackages() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdminEmail(session.user.email)) {
    return { error: "Unauthorized" };
  }

  const popularPackages = await import("@octopus/package-analyzer/src/data/popular-packages.json");
  const entries = Object.entries(popularPackages.default ?? popularPackages) as [string, number][];

  let added = 0;
  for (const [name, downloads] of entries) {
    try {
      await prisma.safePackage.upsert({
        where: { name },
        create: {
          name,
          weeklyDownloads: downloads as number,
          reason: "Popular package (auto-seeded from npm top packages list)",
          approvedBy: session.user.id,
        },
        update: {
          weeklyDownloads: downloads as number,
        },
      });
      added++;
    } catch { /* skip duplicates */ }
  }

  revalidatePath("/admin/safe-packages");
  return { success: true, added };
}
