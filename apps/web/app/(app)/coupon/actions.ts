"use server";

import { headers, cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { addCredits } from "@/lib/credits";
import { writeAuditLog } from "@/lib/audit";

export async function redeemCoupon(code: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Not authenticated" };
  }

  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) {
    return { error: "No organization selected" };
  }

  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) {
    return { error: "Please enter a coupon code" };
  }

  const coupon = await prisma.coupon.findFirst({
    where: { code: normalizedCode, deletedAt: null, isActive: true },
    include: { _count: { select: { redemptions: true } } },
  });

  if (!coupon) {
    return { error: "Invalid coupon code" };
  }

  if (coupon.expiresAt && coupon.expiresAt < new Date()) {
    return { error: "This coupon has expired" };
  }

  if (coupon.maxRedemptions && coupon._count.redemptions >= coupon.maxRedemptions) {
    return { error: "This coupon has reached its usage limit" };
  }

  const [orgRedemption, userRedemption] = await Promise.all([
    prisma.couponRedemption.findUnique({
      where: { couponId_organizationId: { couponId: coupon.id, organizationId: orgId } },
    }),
    prisma.couponRedemption.findUnique({
      where: { couponId_redeemedById: { couponId: coupon.id, redeemedById: session.user.id } },
    }),
  ]);

  if (orgRedemption) {
    return { error: "This coupon has already been redeemed by your organization" };
  }

  if (userRedemption) {
    return { error: "You have already redeemed this coupon" };
  }

  const creditAmount = Number(coupon.creditAmount);

  // Atomic: create redemption inside transaction with re-checked limits.
  // Unique constraints on (couponId, organizationId) and (couponId, redeemedById)
  // provide DB-level protection against concurrent redemptions.
  try {
    await prisma.$transaction(async (tx) => {
      if (coupon.maxRedemptions) {
        const currentCount = await tx.couponRedemption.count({
          where: { couponId: coupon.id },
        });
        if (currentCount >= coupon.maxRedemptions) {
          throw new Error("COUPON_LIMIT_REACHED");
        }
      }

      await tx.couponRedemption.create({
        data: {
          couponId: coupon.id,
          organizationId: orgId,
          redeemedById: session.user.id,
          creditAmount: creditAmount,
        },
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "COUPON_LIMIT_REACHED") {
      return { error: "This coupon has reached its usage limit" };
    }
    // Unique constraint violation — concurrent redemption
    return { error: "This coupon has already been redeemed" };
  }

  await addCredits(orgId, creditAmount, "coupon", `Coupon: ${normalizedCode}`);

  await writeAuditLog({
    action: "coupon.redeemed",
    category: "billing",
    actorId: session.user.id,
    actorEmail: session.user.email,
    organizationId: orgId,
    targetType: "coupon",
    targetId: coupon.id,
    metadata: { code: normalizedCode, creditAmount },
  });

  revalidatePath("/usage");
  revalidatePath("/settings/billing");

  return { success: true, amount: creditAmount };
}
