import { prisma } from "@octopus/db";
import { getStripe } from "./stripe";
import { eventBus } from "./events/bus";

export async function getOrgBalance(orgId: string) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { creditBalance: true, freeCreditBalance: true },
  });

  const free = Number(org.freeCreditBalance);
  const purchased = Number(org.creditBalance);

  return { free, purchased, total: free + purchased };
}

export async function addCredits(
  orgId: string,
  amount: number,
  type: string,
  description?: string,
  stripeSessionId?: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const org = await tx.organization.update({
      where: { id: orgId },
      data: { creditBalance: { increment: amount } },
      select: { creditBalance: true, freeCreditBalance: true },
    });

    const totalAfter = Number(org.creditBalance) + Number(org.freeCreditBalance);

    await tx.creditTransaction.create({
      data: {
        amount,
        type,
        description,
        stripeSessionId,
        balanceAfter: totalAfter,
        organizationId: orgId,
      },
    });
  });
}

export async function addFreeCredits(
  orgId: string,
  amount: number,
  description: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const org = await tx.organization.update({
      where: { id: orgId },
      data: { freeCreditBalance: { increment: amount } },
      select: { creditBalance: true, freeCreditBalance: true },
    });

    const totalAfter = Number(org.creditBalance) + Number(org.freeCreditBalance);

    await tx.creditTransaction.create({
      data: {
        amount,
        type: "free_credit",
        description,
        balanceAfter: totalAfter,
        organizationId: orgId,
      },
    });
  });
}

export async function deductCredits(
  orgId: string,
  amount: number,
  description: string,
): Promise<void> {
  if (amount <= 0) return;

  let totalAfter = 0;

  await prisma.$transaction(async (tx) => {
    // Lock the row to prevent race conditions
    const rows = await tx.$queryRaw<
      Array<{ creditBalance: number; freeCreditBalance: number }>
    >`SELECT "creditBalance"::float, "freeCreditBalance"::float FROM organizations WHERE id = ${orgId} FOR UPDATE`;

    if (rows.length === 0) return;

    const free = rows[0].freeCreditBalance;
    const purchased = rows[0].creditBalance;

    let newFree: number;
    let newPurchased: number;

    if (amount <= free) {
      newFree = free - amount;
      newPurchased = purchased;
    } else {
      const remainder = amount - free;
      newFree = 0;
      newPurchased = purchased - remainder;
    }

    totalAfter = newFree + newPurchased;

    await tx.organization.update({
      where: { id: orgId },
      data: {
        freeCreditBalance: newFree,
        creditBalance: newPurchased,
      },
    });

    await tx.creditTransaction.create({
      data: {
        amount: -amount,
        type: "usage",
        description,
        balanceAfter: totalAfter,
        organizationId: orgId,
      },
    });
  });

  const CREDIT_LOW_THRESHOLD = 10; // dollars
  if (totalAfter > 0 && totalAfter < CREDIT_LOW_THRESHOLD) {
    eventBus.emit({
      type: "credit-low",
      orgId,
      remainingBalance: totalAfter,
    });
  }

  // Check auto-reload after deduction (fire-and-forget)
  triggerAutoReloadIfNeeded(orgId, totalAfter).catch((err) =>
    console.error("[credits] Auto-reload failed:", err),
  );
}

async function triggerAutoReloadIfNeeded(
  orgId: string,
  currentBalance: number,
): Promise<void> {
  const config = await prisma.autoReloadConfig.findUnique({
    where: { organizationId: orgId },
  });

  if (!config || !config.enabled) return;

  const threshold = Number(config.thresholdAmount);
  const reloadAmount = Number(config.reloadAmount);

  if (currentBalance > threshold) return;

  // Need a Stripe customer with a payment method on file
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { stripeCustomerId: true },
  });

  if (!org?.stripeCustomerId) return;

  // Prevent duplicate auto-reloads: check if one happened in the last 5 minutes
  const recentReload = await prisma.creditTransaction.findFirst({
    where: {
      organizationId: orgId,
      type: "auto_reload",
      createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
    },
  });

  if (recentReload) return;

  try {
    // Create a PaymentIntent and confirm immediately using the customer's default payment method
    const paymentIntent = await getStripe().paymentIntents.create({
      amount: Math.round(reloadAmount * 100),
      currency: "usd",
      customer: org.stripeCustomerId,
      off_session: true,
      confirm: true,
      metadata: {
        orgId,
        type: "auto_reload",
        amountUsd: String(reloadAmount),
      },
    });

    if (paymentIntent.status === "succeeded") {
      await addCredits(
        orgId,
        reloadAmount,
        "auto_reload",
        `Auto-reload — $${reloadAmount}`,
        paymentIntent.id,
      );

      // Store receipt URL
      const charge = paymentIntent.latest_charge;
      if (charge && typeof charge === "string") {
        try {
          const chargeObj = await getStripe().charges.retrieve(charge);
          if (chargeObj.receipt_url) {
            await prisma.creditTransaction.update({
              where: { stripeSessionId: paymentIntent.id },
              data: { receiptUrl: chargeObj.receipt_url },
            });
          }
        } catch { /* non-critical */ }
      }

      console.log(`[credits] Auto-reload $${reloadAmount} for org ${orgId}`);
    }
  } catch (err) {
    // Payment failed (no default payment method, card declined, etc.)
    console.error("[credits] Auto-reload payment failed:", err);
  }
}

export async function hasEnoughCredits(
  orgId: string,
  estimatedCost: number,
): Promise<boolean> {
  const { total } = await getOrgBalance(orgId);
  return total >= estimatedCost;
}
