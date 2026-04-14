"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { prisma } from "@octopus/db";
import { writeAuditLog } from "@/lib/audit";

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdminEmail(session.user.email)) {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function createCoupon(formData: FormData) {
  const session = await requireAdmin();

  const rawCode = formData.get("code") as string;
  const creditAmount = Number(formData.get("creditAmount"));
  const maxRedemptions = formData.get("maxRedemptions")
    ? Number(formData.get("maxRedemptions"))
    : null;
  const expiresAt = formData.get("expiresAt")
    ? new Date(formData.get("expiresAt") as string)
    : null;
  const description = (formData.get("description") as string) || null;

  if (!rawCode?.trim()) {
    return { error: "Coupon code is required" };
  }

  const code = rawCode.trim().toUpperCase();

  if (code.length > 50) {
    return { error: "Coupon code must be 50 characters or less" };
  }

  if (!/^[A-Z0-9_-]+$/.test(code)) {
    return { error: "Coupon code can only contain letters, numbers, hyphens, and underscores" };
  }

  if (!creditAmount || creditAmount <= 0) {
    return { error: "Credit amount must be greater than 0" };
  }

  const existing = await prisma.coupon.findFirst({
    where: { code, deletedAt: null },
  });

  if (existing) {
    return { error: "A coupon with this code already exists" };
  }

  const coupon = await prisma.coupon.create({
    data: {
      code,
      creditAmount,
      maxRedemptions,
      expiresAt,
      description,
      createdById: session.user.id,
    },
  });

  await writeAuditLog({
    action: "coupon.created",
    category: "admin",
    actorId: session.user.id,
    actorEmail: session.user.email,
    targetType: "coupon",
    targetId: coupon.id,
    metadata: { code, creditAmount, maxRedemptions },
  });

  revalidatePath("/admin/coupons");
  return { success: true };
}

export async function toggleCouponActive(couponId: string) {
  const session = await requireAdmin();

  const coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
  if (!coupon || coupon.deletedAt) {
    return { error: "Coupon not found" };
  }

  await prisma.coupon.update({
    where: { id: couponId },
    data: { isActive: !coupon.isActive },
  });

  await writeAuditLog({
    action: coupon.isActive ? "coupon.deactivated" : "coupon.activated",
    category: "admin",
    actorId: session.user.id,
    actorEmail: session.user.email,
    targetType: "coupon",
    targetId: couponId,
    metadata: { code: coupon.code },
  });

  revalidatePath("/admin/coupons");
  return { success: true };
}

export async function deleteCoupon(couponId: string) {
  const session = await requireAdmin();

  const coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
  if (!coupon || coupon.deletedAt) {
    return { error: "Coupon not found" };
  }

  await prisma.coupon.update({
    where: { id: couponId },
    data: { deletedAt: new Date() },
  });

  await writeAuditLog({
    action: "coupon.deleted",
    category: "admin",
    actorId: session.user.id,
    actorEmail: session.user.email,
    targetType: "coupon",
    targetId: couponId,
    metadata: { code: coupon.code },
  });

  revalidatePath("/admin/coupons");
  return { success: true };
}
