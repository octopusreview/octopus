"use server";

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import {
  createCheckoutSession,
  createSubscriptionCheckoutSession,
  getOffSessionPaymentMethodId,
  getOrCreateStripeCustomer,
  getStripe,
} from "@/lib/stripe";
import { SUBSCRIPTION_PLANS, isPaidPlanTier } from "@/lib/plans";
import {
  chargeCreditsOffSession,
  rearmAutoReloadAfterPaymentMethodChange,
  updateAutoReloadConfigDurably,
} from "@/lib/credits";
import { chargeSubscription, grantSubscriptionPeriod, addOneMonth } from "@/lib/subscription";

async function getOwnerOrgId(): Promise<{ orgId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) return { error: "No organization selected." };

  const member = await prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId: session.user.id,
      deletedAt: null,
    },
    select: { role: true },
  });

  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return { error: "Only organization owners and admins can manage billing." };
  }

  return { orgId };
}

export async function purchaseCredits(
  amount: number,
): Promise<{ url?: string; success?: boolean; error?: string }> {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 5 || amount > 1000) {
    return { error: "Amount must be between $5 and $1,000." };
  }

  const result = await getOwnerOrgId();
  if ("error" in result) return { error: result.error };

  // Returning buyer with a saved card → charge off-session, grant in-app, no
  // redirect. A declined saved card surfaces an in-app error (they update the
  // card and retry) — deliberately NOT a Checkout bounce. Only a first-time
  // buyer with no card on file falls back to Stripe Checkout.
  //
  // Deterministic idempotency key (structured like the subscription flow),
  // bucketed to 30 seconds: a double-submit of the same amount within the
  // window collapses to a single Stripe charge (the second returns the same
  // PaymentIntent, whose grant is already committed → P2002 no-op). A genuine
  // repeat purchase after the window lands in a new bucket → a new charge.
  const bucket = Math.floor(Date.now() / 30_000);
  const idempotencyKey = `purchase-${result.orgId}-${amount}-${bucket}`;
  const charge = await chargeCreditsOffSession(result.orgId, amount, idempotencyKey);
  if (charge.status === "succeeded") {
    revalidatePath("/settings/billing");
    return { success: true };
  }
  if (charge.status === "failed") {
    // Only blame the customer's card on a genuine decline. Platform/Stripe-side
    // failures (config, auth, network, unexpected status) get a neutral message
    // and are logged in chargeCreditsOffSession for us to investigate.
    return {
      error: charge.cardError
        ? "Your saved card was declined. Update your card and try again."
        : "We couldn't process your payment right now. Please try again in a moment — if it keeps happening, contact support and we'll sort it out.",
    };
  }

  const url = await createCheckoutSession(
    result.orgId,
    amount,
    `${process.env.BETTER_AUTH_URL || "http://localhost:3000"}/settings/billing`,
  );

  return { url };
}

/**
 * In-app card capture: create a SetupIntent whose client_secret the billing
 * page feeds to an embedded Stripe Payment Element — no redirect to Stripe.
 */
export async function createCardSetupIntent(): Promise<{
  clientSecret?: string;
  error?: string;
}> {
  const result = await getOwnerOrgId();
  if ("error" in result) return { error: result.error };

  try {
    const customerId = await getOrCreateStripeCustomer(result.orgId);
    const intent = await getStripe().setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      usage: "off_session",
      metadata: { orgId: result.orgId },
    });
    if (!intent.client_secret) return { error: "Could not start card setup." };
    return { clientSecret: intent.client_secret };
  } catch (err) {
    console.error("[billing] createCardSetupIntent failed:", err);
    return { error: "Could not start card setup. Please try again." };
  }
}

/**
 * After the Payment Element confirms the SetupIntent client-side, make the
 * new card the customer's default so off-session charges (auto-reload,
 * subscription renewals) use it. Verifies the intent belongs to THIS org's
 * customer — the id comes from the browser.
 */
export async function finalizeCardSetup(
  setupIntentId: string,
): Promise<{ success?: boolean; error?: string }> {
  if (typeof setupIntentId !== "string" || !setupIntentId.startsWith("seti_")) {
    return { error: "Invalid card setup reference." };
  }

  const result = await getOwnerOrgId();
  if ("error" in result) return { error: result.error };

  try {
    const org = await prisma.organization.findUnique({
      where: { id: result.orgId },
      select: { stripeCustomerId: true },
    });
    if (!org?.stripeCustomerId) return { error: "No billing account for this organization." };

    const intent = await getStripe().setupIntents.retrieve(setupIntentId);
    if (intent.customer !== org.stripeCustomerId) {
      return { error: "Card setup doesn't belong to this organization." };
    }
    if (intent.status !== "succeeded" || typeof intent.payment_method !== "string") {
      return { error: "Card setup hasn't completed." };
    }

    await getStripe().customers.update(org.stripeCustomerId, {
      invoice_settings: { default_payment_method: intent.payment_method },
    });

    // One card per customer: detach every previously-attached card so a
    // "Replace card" leaves exactly the new one (matches the UI copy, and
    // stops stale cards being reachable for off-session charges). Best-effort
    // — the new default is already set, so a detach failure must not fail the
    // save.
    try {
      const existing = await getStripe().paymentMethods.list({
        customer: org.stripeCustomerId,
        type: "card",
      });
      await Promise.all(
        existing.data
          .filter((pm) => pm.id !== intent.payment_method)
          .map((pm) => getStripe().paymentMethods.detach(pm.id)),
      );
    } catch (err) {
      console.error("[billing] finalizeCardSetup: detaching old cards failed (non-fatal):", err);
    }

    try {
      await rearmAutoReloadAfterPaymentMethodChange(result.orgId);
    } catch (err) {
      console.error("[billing] finalizeCardSetup: auto-reload rearm failed:", err);
      return {
        error: "Card saved, but auto-reload could not restart. Please save it again.",
      };
    }

    revalidatePath("/settings/billing");
    return { success: true };
  } catch (err) {
    console.error("[billing] finalizeCardSetup failed:", err);
    return { error: "Could not save the card. Please try again." };
  }
}

export async function subscribeToPlan(
  tier: string,
): Promise<{ url?: string; success?: boolean; error?: string }> {
  if (!isPaidPlanTier(tier)) return { error: "Unknown plan." };

  const result = await getOwnerOrgId();
  if ("error" in result) return { error: result.error };

  const org = await prisma.organization.findUnique({
    where: { id: result.orgId },
    select: { planTier: true },
  });
  if (org?.planTier === tier) return { error: "Already on this plan." };

  try {
    // Saved card? Charge off-session right now; otherwise send to Checkout
    // (which saves the card for renewals). The idempotency key is stable for
    // the calendar day, so a double-clicked subscribe can't charge twice.
    const day = new Date().toISOString().slice(0, 10);
    const chargeRef = await chargeSubscription(
      result.orgId,
      tier,
      `sub-start-${result.orgId}-${tier}-${day}`,
    );
    if (chargeRef) {
      await grantSubscriptionPeriod(result.orgId, tier, chargeRef, addOneMonth(new Date()));
      revalidatePath("/settings/billing");
      return { success: true };
    }

    const plan = SUBSCRIPTION_PLANS[tier];
    const url = await createSubscriptionCheckoutSession(
      result.orgId,
      tier,
      plan.name,
      plan.priceUsd,
      `${process.env.BETTER_AUTH_URL || "http://localhost:3000"}/settings/billing`,
    );
    return { url };
  } catch (err) {
    console.error("[billing] subscribeToPlan failed:", err);
    return { error: "Could not start the subscription. Please try again or update your card." };
  }
}

export async function setSubscriptionCancel(
  cancel: boolean,
): Promise<{ success?: boolean; error?: string }> {
  const result = await getOwnerOrgId();
  if ("error" in result) return { error: result.error };

  const org = await prisma.organization.findUnique({
    where: { id: result.orgId },
    select: { planTier: true },
  });
  if (!org || org.planTier === "free") return { error: "No active subscription." };

  await prisma.organization.update({
    where: { id: result.orgId },
    data: { planCancelAtPeriodEnd: cancel },
  });

  revalidatePath("/settings/billing");
  return { success: true };
}

export async function updateAutoReload(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const result = await getOwnerOrgId();
  if ("error" in result) return { error: result.error };

  const enabled = formData.get("enabled") === "true";
  const thresholdAmount = Number(formData.get("thresholdAmount"));
  const reloadAmount = Number(formData.get("reloadAmount"));

  if (enabled && (!Number.isFinite(thresholdAmount) || thresholdAmount < 1 || thresholdAmount > 1000)) {
    return { error: "Threshold must be between $1 and $1,000." };
  }

  if (enabled && (!Number.isFinite(reloadAmount) || reloadAmount < 5 || reloadAmount > 1000)) {
    return { error: "Reload amount must be between $5 and $1,000." };
  }

  if (enabled) {
    const org = await prisma.organization.findUnique({
      where: { id: result.orgId },
      select: { stripeCustomerId: true },
    });
    if (!org?.stripeCustomerId) {
      return { error: "Add a payment method before enabling auto-reload." };
    }

    try {
      if (!(await getOffSessionPaymentMethodId(org.stripeCustomerId))) {
        return { error: "Add a payment method before enabling auto-reload." };
      }
    } catch (err) {
      console.error("[billing] could not verify auto-reload payment method:", err);
      return { error: "Could not verify your payment method. Please try again." };
    }
  }

  const thresholdValid = Number.isFinite(thresholdAmount)
    && thresholdAmount >= 1
    && thresholdAmount <= 1000;
  const reloadValid = Number.isFinite(reloadAmount)
    && reloadAmount >= 5
    && reloadAmount <= 1000;
  let savedThreshold = thresholdValid ? thresholdAmount : 10;
  let savedReload = reloadValid ? reloadAmount : 50;
  if (!thresholdValid || !reloadValid) {
    const existing = await prisma.autoReloadConfig.findUnique({
      where: { organizationId: result.orgId },
      select: { thresholdAmount: true, reloadAmount: true },
    });
    if (existing) {
      const storedThreshold = Number(existing.thresholdAmount);
      const storedReload = Number(existing.reloadAmount);
      if (!thresholdValid && Number.isFinite(storedThreshold)) {
        savedThreshold = Math.min(Math.max(storedThreshold, 1), 1000);
      }
      if (!reloadValid && Number.isFinite(storedReload)) {
        savedReload = Math.min(Math.max(storedReload, 5), 1000);
      }
    }
  }
  try {
    await updateAutoReloadConfigDurably(
      result.orgId,
      enabled,
      savedThreshold,
      savedReload,
    );
  } catch (err) {
    console.error("[billing] durable auto-reload update failed:", err);
    return { error: "Could not update auto-reload. Please try again." };
  }

  revalidatePath("/settings/billing");
  return { success: true };
}

export async function updateBillingEmail(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const result = await getOwnerOrgId();
  if ("error" in result) return { error: result.error };

  const billingEmail = (formData.get("billingEmail") as string)?.trim() || null;

  if (billingEmail && !billingEmail.includes("@")) {
    return { error: "Invalid email address." };
  }

  const org = await prisma.organization.update({
    where: { id: result.orgId },
    data: { billingEmail },
    select: { stripeCustomerId: true },
  });

  // Sync email to Stripe customer
  if (org.stripeCustomerId && billingEmail) {
    await getStripe().customers.update(org.stripeCustomerId, {
      email: billingEmail,
    }).catch((err) => console.error("[billing] Failed to update Stripe email:", err));
  }

  revalidatePath("/settings/billing");
  return { success: true };
}

export async function updateSpendLimit(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const result = await getOwnerOrgId();
  if ("error" in result) return { error: result.error };

  const raw = formData.get("monthlySpendLimitUsd") as string;
  const monthlySpendLimitUsd = raw ? Number(raw) : null;

  if (
    monthlySpendLimitUsd !== null &&
    (!Number.isFinite(monthlySpendLimitUsd) || monthlySpendLimitUsd < 0)
  ) {
    return { error: "Invalid spend limit." };
  }

  await prisma.organization.update({
    where: { id: result.orgId },
    data: { monthlySpendLimitUsd },
  });

  revalidatePath("/settings/billing");
  return { success: true };
}

export type TransactionDTO = {
  id: string;
  amount: number;
  type: string;
  description: string | null;
  receiptUrl: string | null;
  balanceAfter: number;
  createdAt: string;
};

export async function loadMoreTransactions(
  orgId: string,
  offset: number,
  limit: number = 20,
): Promise<TransactionDTO[]> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return [];

  const member = await prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId: session.user.id,
      deletedAt: null,
    },
  });

  if (!member) return [];

  const rows = await prisma.creditTransaction.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    skip: offset,
    take: limit,
  });

  return rows.map((t) => ({
    id: t.id,
    amount: Number(t.amount),
    type: t.type,
    description: t.description,
    receiptUrl: t.receiptUrl,
    balanceAfter: Number(t.balanceAfter),
    createdAt: t.createdAt.toISOString(),
  }));
}
