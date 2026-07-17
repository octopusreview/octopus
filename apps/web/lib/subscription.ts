import { prisma } from "@octopus/db";
import { addCredits } from "@/lib/credits";
import { getStripe, getOffSessionPaymentMethodId } from "@/lib/stripe";
import { SUBSCRIPTION_PLANS, type PaidPlanTier } from "@/lib/plans";

/**
 * Monthly subscriptions WITHOUT Stripe Billing: each period we charge the
 * org's saved card with an off-session PaymentIntent (exactly like
 * auto-reload in credits.ts) and grant the plan's credits into the unified
 * balance. The daily `subscription-renewals` cron (instrumentation.ts →
 * queue-workers.ts) picks up orgs whose planRenewsAt has passed.
 *
 * Idempotency: the credit grant is keyed on the PaymentIntent id via the
 * ledger's unique stripeSessionId, so a crash between charge and grant is
 * healed on the next run (P2002 → treated as already-granted).
 * ponytail: migrate to real Stripe Billing (invoices/proration/tax) only
 * when MRR justifies the catalog build — tracked in #619.
 */

/** Days past the renewal date we keep retrying the card before downgrading. */
const RENEWAL_GRACE_DAYS = 7;

/** Add one calendar month, clamping the day (Jan 31 → Feb 28, not Mar 3). */
export function addOneMonth(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, daysInMonth));
  return d;
}

async function backfillReceipt(paymentIntentId: string): Promise<void> {
  try {
    const charges = await getStripe().charges.list({ payment_intent: paymentIntentId, limit: 1 });
    const receiptUrl = charges.data[0]?.receipt_url;
    if (receiptUrl) {
      await prisma.creditTransaction.update({
        where: { stripeSessionId: paymentIntentId },
        data: { receiptUrl },
      });
    }
  } catch {
    /* non-critical */
  }
}

function isDuplicateLedgerError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "P2002";
}

/**
 * Grant a period's credits and stamp the plan state. `chargeRef` is the
 * Stripe PaymentIntent (or Checkout session) id — the idempotency key.
 * `renewsAt` is the NEXT renewal date to record.
 */
export async function grantSubscriptionPeriod(
  orgId: string,
  tier: PaidPlanTier,
  chargeRef: string,
  renewsAt: Date,
): Promise<void> {
  const plan = SUBSCRIPTION_PLANS[tier];
  try {
    await addCredits(
      orgId,
      plan.creditsUsd,
      "subscription",
      `${plan.name} plan — $${plan.creditsUsd} credits`,
      chargeRef,
    );
  } catch (err) {
    if (!isDuplicateLedgerError(err)) throw err;
    // Already granted for this charge (webhook redelivery / crash recovery) —
    // the plan state was stamped then too; recomputing renewsAt now would
    // drift the billing anchor, so this is a full no-op.
    return;
  }
  await prisma.organization.update({
    where: { id: orgId },
    data: { planTier: tier, planRenewsAt: renewsAt, planCancelAtPeriodEnd: false },
  });
  await backfillReceipt(chargeRef);
}

/**
 * Charge the saved card off-session for one period of `tier`.
 * `idempotencyKey` must be deterministic for the billing event (org + period)
 * so concurrent callers — double-clicked subscribe, overlapping cron runs —
 * collapse into ONE Stripe charge instead of two.
 * Returns the PaymentIntent id on success, null when the org has no saved
 * card or the charge fails (caller decides: fall back to Checkout, or leave
 * for the next daily retry).
 */
export async function chargeSubscription(
  orgId: string,
  tier: PaidPlanTier,
  idempotencyKey: string,
): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { stripeCustomerId: true },
  });
  if (!org?.stripeCustomerId) return null;

  const paymentMethod = await getOffSessionPaymentMethodId(org.stripeCustomerId);
  if (!paymentMethod) return null;

  const plan = SUBSCRIPTION_PLANS[tier];
  try {
    const paymentIntent = await getStripe().paymentIntents.create(
      {
        amount: Math.round(plan.priceUsd * 100),
        currency: "usd",
        customer: org.stripeCustomerId,
        payment_method: paymentMethod,
        off_session: true,
        confirm: true,
        metadata: { orgId, type: "subscription", tier, amountUsd: String(plan.priceUsd) },
      },
      { idempotencyKey },
    );
    if (paymentIntent.status !== "succeeded") return null;
    return paymentIntent.id;
  } catch (err) {
    console.error(`[subscription] Charge failed for org ${orgId} (${tier}):`, err);
    return null;
  }
}

/**
 * Daily cron body: renew every org whose period has lapsed.
 * - cancel-at-period-end orgs are downgraded to free;
 * - otherwise charge the saved card and grant the next period;
 * - charge failures are retried daily until RENEWAL_GRACE_DAYS past due,
 *   then the org drops to free (credits already granted are kept).
 * Returns counts for the cron log.
 */
export async function renewDueSubscriptions(): Promise<{
  renewed: number;
  canceled: number;
  downgraded: number;
  failed: number;
}> {
  const now = new Date();
  const due = await prisma.organization.findMany({
    where: {
      planTier: { not: "free" },
      planRenewsAt: { lte: now },
      deletedAt: null,
    },
    select: { id: true, planTier: true, planRenewsAt: true, planCancelAtPeriodEnd: true },
  });

  let renewed = 0;
  let canceled = 0;
  let downgraded = 0;
  let failed = 0;

  for (const org of due) {
    if (org.planCancelAtPeriodEnd || !(org.planTier in SUBSCRIPTION_PLANS)) {
      await prisma.organization.update({
        where: { id: org.id },
        data: { planTier: "free", planRenewsAt: null, planCancelAtPeriodEnd: false },
      });
      canceled++;
      continue;
    }

    const tier = org.planTier as PaidPlanTier;
    // Keyed on the due date: every retry of THIS period reuses the key (no
    // double-charge from overlapping runs), while next period gets a new one.
    const chargeRef = await chargeSubscription(
      org.id,
      tier,
      `sub-renew-${org.id}-${(org.planRenewsAt ?? now).toISOString()}`,
    );
    if (chargeRef) {
      // Advance from the DUE date (not now) so billing anchors don't drift.
      const base = org.planRenewsAt ?? now;
      await grantSubscriptionPeriod(org.id, tier, chargeRef, addOneMonth(base));
      renewed++;
      continue;
    }

    const graceCutoff = new Date(now.getTime() - RENEWAL_GRACE_DAYS * 24 * 60 * 60 * 1000);
    if (org.planRenewsAt && org.planRenewsAt < graceCutoff) {
      await prisma.organization.update({
        where: { id: org.id },
        data: { planTier: "free", planRenewsAt: null, planCancelAtPeriodEnd: false },
      });
      downgraded++;
      console.warn(`[subscription] Org ${org.id} downgraded after ${RENEWAL_GRACE_DAYS}d of failed renewals`);
    } else {
      failed++;
    }
  }

  return { renewed, canceled, downgraded, failed };
}
