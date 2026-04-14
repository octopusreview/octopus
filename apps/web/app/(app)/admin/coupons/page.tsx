import { prisma } from "@octopus/db";
import { CouponsAdmin } from "./coupons-admin";

export default async function CouponsPage() {
  const coupons = await prisma.coupon.findMany({
    where: { deletedAt: null },
    include: { _count: { select: { redemptions: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <CouponsAdmin
      coupons={coupons.map((c) => ({
        id: c.id,
        code: c.code,
        description: c.description,
        creditAmount: Number(c.creditAmount),
        maxRedemptions: c.maxRedemptions,
        isActive: c.isActive,
        expiresAt: c.expiresAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
        redemptionCount: c._count.redemptions,
      }))}
    />
  );
}
