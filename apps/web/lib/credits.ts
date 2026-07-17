import { prisma } from "@octopus/db";
import { getStripe, getOffSessionPaymentMethodId } from "./stripe";
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
  // When set (refund path), the ledger row carries this id under a UNIQUE
  // column so a replayed/duplicate refund event hits a constraint violation and
  // the whole transaction rolls back instead of debiting twice. Left undefined
  // for ordinary usage deductions (which are intentionally non-unique).
  stripeRefundId?: string,
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
        stripeRefundId,
        balanceAfter: totalAfter,
        organizationId: orgId,
      },
    });
  });

  await maybeNotifyCreditLow(orgId, totalAfter);

  // Check auto-reload after deduction (fire-and-forget)
  triggerAutoReloadIfNeeded(orgId, totalAfter).catch((err) =>
    console.error("[credits] Auto-reload failed:", err),
  );
}

// Minimum low-credit threshold for slow/steady usage; preserves the original
// $10 warning floor so nothing regresses for low-volume orgs.
const CREDIT_LOW_FLOOR = 10; // dollars
// Window used to estimate the org's recent burn rate.
const BURN_LOOKBACK_MS = 60 * 60 * 1000; // 1 hour
// Skip the burn-rate query entirely for well-funded orgs to keep the
// deduction hot path cheap. Orgs above this balance never need a warning;
// the next deduction that drops them below it will re-evaluate.
const BURN_QUERY_CEILING = 100; // dollars

/**
 * Emit a `credit-low` event when the balance can no longer cover the org's
 * projected next hour of usage. The threshold adapts to burn rate: a fast
 * burner is warned with roughly an hour of runway left, while a slow/steady
 * org keeps the original $10 floor.
 */
async function maybeNotifyCreditLow(
  orgId: string,
  totalAfter: number,
): Promise<void> {
  if (totalAfter <= 0 || totalAfter >= BURN_QUERY_CEILING) return;

  // Sum of usage over the last hour. Usage amounts are stored negative, so the
  // absolute value is dollars-per-hour at the recent pace.
  const recent = await prisma.creditTransaction.aggregate({
    where: {
      organizationId: orgId,
      type: "usage",
      createdAt: { gte: new Date(Date.now() - BURN_LOOKBACK_MS) },
    },
    _sum: { amount: true },
  });

  const burnPerHour = Math.abs(Number(recent._sum.amount ?? 0));
  // Warn once the balance can't fund the next projected hour, never below the floor.
  const threshold = Math.max(CREDIT_LOW_FLOOR, burnPerHour);

  if (totalAfter >= threshold) return;

  eventBus.emit({
    type: "credit-low",
    orgId,
    remainingBalance: totalAfter,
    burnRatePerHour: burnPerHour,
    runwayMinutes: burnPerHour > 0 ? (totalAfter / burnPerHour) * 60 : undefined,
  });
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
    // Cards saved via Checkout are attached but not the customer default, and
    // an off-session confirm does not fall back to attached cards — resolve
    // the payment method explicitly or the reload silently no-ops.
    const paymentMethod = await getOffSessionPaymentMethodId(org.stripeCustomerId);
    if (!paymentMethod) return;

    const paymentIntent = await getStripe().paymentIntents.create({
      amount: Math.round(reloadAmount * 100),
      currency: "usd",
      customer: org.stripeCustomerId,
      payment_method: paymentMethod,
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
