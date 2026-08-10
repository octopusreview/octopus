import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { constructWebhookEvent, getStripe } from "@/lib/stripe";
import {
  addCredits,
  addFreeCredits,
  applyAutoReloadPaymentIntent,
  autoReloadPaymentIntentMatches,
  deductCredits,
  getOrgBalance,
  grantAutoReloadFromPaymentIntent,
  grantPurchaseFromPaymentIntent,
  stripeObjectId,
} from "@/lib/credits";
import { grantSubscriptionPeriod, addOneMonth } from "@/lib/subscription";
import { isPaidPlanTier, volumeBonusUsd } from "@/lib/plans";
import { prisma } from "@octopus/db";
import type Stripe from "stripe";

async function getMatchingAutoReloadAttempt(
  intent: Stripe.PaymentIntent,
  requireReceivedAmount: boolean,
) {
  const orgId = intent.metadata?.orgId;
  const attemptId = intent.metadata?.autoReloadAttemptId;
  const idempotencyKey = intent.metadata?.autoReloadKey;
  // Both durable fields absent means an old replica created this PI during the
  // rolling deploy. Partial durable metadata is never accepted as legacy.
  if (!attemptId && !idempotencyKey) return null;
  if (!orgId || !attemptId || !idempotencyKey) {
    throw new Error("Auto-reload PaymentIntent has incomplete durable metadata");
  }

  const attempt = await prisma.autoReloadAttempt.findFirst({
    where: {
      id: attemptId,
      organizationId: orgId,
      idempotencyKey,
    },
  });
  if (!attempt) {
    throw new Error("Auto-reload PaymentIntent has no matching durable attempt");
  }

  if (!autoReloadPaymentIntentMatches(intent, orgId, attempt, requireReceivedAmount)) {
    throw new Error("Auto-reload PaymentIntent does not match its durable attempt");
  }

  return { attempt, orgId, attemptId, idempotencyKey };
}

const LEGACY_AUTO_RELOAD_MIN_CENTS = 500;
// The pre-migration config only enforced reloadAmount >= 5 into a
// Decimal(12,4) column, so the upper bound is Stripe's own USD ceiling.
const LEGACY_AUTO_RELOAD_MAX_CENTS = 99_999_999;

/**
 * Recover a succeeded PI created by an old replica during a rolling deploy.
 * This deliberately accepts only the exact legacy shape, and the PI id remains
 * the unique credit-ledger key. Newly formatted PIs always take the strict
 * durable-attempt path above.
 */
async function grantValidatedLegacyAutoReload(intent: Stripe.PaymentIntent): Promise<void> {
  const metadata = intent.metadata;
  const orgId = metadata?.orgId;
  const rawMetadataAmount = metadata?.amountUsd;
  const metadataAmount = Number(rawMetadataAmount);
  const metadataAmountCents = Math.round(metadataAmount * 100);

  if (
    !orgId
    || metadata?.type !== "auto_reload"
    || metadata?.autoReloadAttemptId
    || metadata?.autoReloadKey
    || intent.status !== "succeeded"
    || intent.currency !== "usd"
    || typeof rawMetadataAmount !== "string"
    || !/^\d{1,6}(?:\.\d{1,4})?$/.test(rawMetadataAmount)
    || !Number.isFinite(metadataAmount)
    || metadataAmount <= 0
    || intent.amount !== metadataAmountCents
    || intent.amount_received !== intent.amount
    || intent.amount < LEGACY_AUTO_RELOAD_MIN_CENTS
    || intent.amount > LEGACY_AUTO_RELOAD_MAX_CENTS
  ) {
    throw new Error("Legacy auto-reload PaymentIntent failed validation");
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { stripeCustomerId: true },
  });
  if (!org?.stripeCustomerId || stripeObjectId(intent.customer) !== org.stripeCustomerId) {
    throw new Error("Legacy auto-reload PaymentIntent customer does not match its organization");
  }

  await grantAutoReloadFromPaymentIntent(
    orgId,
    metadataAmount,
    intent.id,
    intent.latest_charge,
  );
}

async function getReceiptUrl(paymentIntentId: string | null): Promise<string | null> {
  if (!paymentIntentId) return null;
  try {
    const charges = await getStripe().charges.list({ payment_intent: paymentIntentId, limit: 1 });
    return charges.data[0]?.receipt_url ?? null;
  } catch {
    return null;
  }
}

// A duplicate webhook delivery hits a UNIQUE constraint on the ledger row
// (stripeSessionId for purchases, stripeRefundId for refunds), which Prisma
// surfaces as error code P2002. That means "already processed" — safe to ACK.
// Detect it structurally by code, not by matching the (unstable) message text.
function isDuplicateLedgerError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "P2002";
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event;
  try {
    event = constructWebhookEvent(body, signature);
  } catch (err) {
    console.error("[stripe-webhook] Signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // NOTE on Stripe API versions: the SDK pin in lib/stripe.ts governs OUTBOUND
  // calls, but webhook event payload SHAPES are set by the endpoint's version
  // configured in the Stripe dashboard — the two are independent. This handler
  // reads only version-stable fields (metadata, object ids, amounts,
  // payment_intent, payment_status), so an SDK/dashboard version skew (e.g.
  // after an SDK major bump) does not affect it. If you start reading a
  // version-sensitive field, first align the dashboard endpoint version.

  // Single retry contract for value-bearing work: a duplicate delivery (P2002)
  // is ACKed with 200 (idempotent skip); ANY other failure returns 500 so Stripe
  // retries — otherwise a transient DB/Stripe error would silently drop a paid
  // customer's credits, since we'd have ACKed 200 and Stripe never re-delivers.
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const orgId = session.metadata?.orgId;
      const type = session.metadata?.type;
      const amountUsd = Number(session.metadata?.amountUsd || 0);

      // checkout.session.completed fires even when payment is still pending
      // (async payment methods); only grant once Stripe reports it paid.
      // Cards — the only method we accept — are always "paid" at completion.
      const isPaid = session.payment_status === "paid";

      if (isPaid && orgId && type === "credit_purchase" && amountUsd > 0) {
        try {
          await addCredits(
            orgId,
            amountUsd,
            "purchase",
            `Credit purchase — $${amountUsd}`,
            session.id,
          );
        } catch (err) {
          if (isDuplicateLedgerError(err)) {
            console.log("[stripe-webhook] Duplicate session, skipping:", session.id);
            return NextResponse.json({ received: true });
          }
          throw err;
        }

        // Volume bonus on top of the paid amount (separate free_credit row so
        // it never inflates the "purchased"/revenue figure). Reached only on
        // the first, non-duplicate delivery — a redelivery returns early above.
        // Best-effort: the purchase is already committed, so a bonus failure
        // must not 500 and re-drive the purchase (which would then skip the
        // bonus on retry). A rare lost bonus is logged, not double-granted.
        const bonusUsd = volumeBonusUsd(amountUsd);
        if (bonusUsd > 0) {
          try {
            await addFreeCredits(orgId, bonusUsd, `Volume bonus — $${bonusUsd} on $${amountUsd} purchase`);
          } catch (err) {
            console.error("[stripe-webhook] Volume bonus grant failed (non-fatal):", err);
          }
        }

        // Best-effort receipt backfill — the credits are already committed, so a
        // failure here must NOT turn into a 500 that re-drives the grant.
        try {
          const receiptUrl = await getReceiptUrl(
            typeof session.payment_intent === "string" ? session.payment_intent : null,
          );
          if (receiptUrl) {
            await prisma.creditTransaction.update({
              where: { stripeSessionId: session.id },
              data: { receiptUrl },
            });
          }
        } catch (err) {
          console.error("[stripe-webhook] Receipt URL backfill failed (non-fatal):", err);
        }
      }
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const orgId = session.metadata?.orgId;
      const tier = session.metadata?.tier;

      const isPaid = session.payment_status === "paid";

      if (isPaid && session.metadata?.type === "subscription_start" && orgId && tier && isPaidPlanTier(tier)) {
        // Idempotent: the grant is keyed on session.id; a redelivery re-runs
        // grantSubscriptionPeriod, which treats the duplicate ledger row as
        // already-granted and re-stamps the same plan state.
        await grantSubscriptionPeriod(orgId, tier, session.id, addOneMonth(new Date()));
      }
    }

    if (event.type === "charge.refunded") {
      const charge = event.data.object;
      const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;

      if (paymentIntentId) {
        // Find the org: Checkout purchases carry orgId on the session, but
        // off-session charges (auto-reload, subscription, direct top-ups) have
        // no session — those carry orgId on the PaymentIntent metadata. Try the
        // session first, then fall back to the intent so every charge's refund
        // is attributable.
        const sessions = await getStripe().checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
        let orgId = sessions.data[0]?.metadata?.orgId;
        if (!orgId) {
          const intent = await getStripe().paymentIntents.retrieve(paymentIntentId);
          orgId = intent.metadata?.orgId;
        }

        if (orgId) {
          // Deduct each refund INDIVIDUALLY, keyed on its own id, using the
          // per-refund amount — NOT charge.amount_refunded, which is the running
          // cumulative total (deducting that on every delivery, or on a second
          // partial refund, would over-debit). The unique stripeRefundId makes a
          // redelivered event a no-op (P2002 → rolled back). Auto-paginate so a
          // charge with >100 refunds is fully covered, and only act on refunds
          // that actually moved money — pending/failed/canceled refunds still
          // carry a nonzero `amount` but must not debit the balance.
          for await (const refund of getStripe().refunds.list({ charge: charge.id })) {
            const amount = refund.amount / 100;
            if (refund.status !== "succeeded" || amount <= 0) continue;
            try {
              await deductCredits(orgId, amount, `Refund — $${amount}`, refund.id);
              console.log(`[stripe-webhook] Refund processed: $${amount} for org ${orgId} (${refund.id})`);
            } catch (err) {
              if (isDuplicateLedgerError(err)) {
                console.log("[stripe-webhook] Duplicate refund, skipping:", refund.id);
                continue;
              }
              throw err;
            }
          }
        }
      }
    }

    // Authoritative grant for our off-session PaymentIntents. Inline grants
    // provide instant feedback, while this webhook recovers a process/DB
    // failure after Stripe has charged the card. Both paths key the ledger on
    // the PI id, so they collapse to exactly one grant (P2002-idempotent).
    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object;
      const orgId = intent.metadata?.orgId;
      const amountUsd = Number(intent.metadata?.amountUsd || 0);
      if (intent.metadata?.type === "credit_purchase" && orgId && amountUsd > 0) {
        await grantPurchaseFromPaymentIntent(orgId, amountUsd, intent.id, intent.latest_charge);
      } else if (intent.metadata?.type === "auto_reload") {
        const matched = await getMatchingAutoReloadAttempt(intent, true);
        if (matched) {
          const balance = await getOrgBalance(matched.orgId);
          await applyAutoReloadPaymentIntent(
            matched.orgId,
            balance.total,
            intent,
            matched.attempt,
          );
        } else {
          await grantValidatedLegacyAutoReload(intent);
        }
      }
    }

    if (event.type === "payment_intent.payment_failed") {
      const intent = event.data.object;
      console.error("[stripe-webhook] Payment failed:", intent.id, intent.last_payment_error?.message);
      if (intent.metadata?.type === "auto_reload") {
        const matched = await getMatchingAutoReloadAttempt(intent, false);
        if (matched) {
          // Event delivery is unordered. Re-read Stripe's current PI before
          // changing durable state so an older failure snapshot cannot demote
          // a PI that has since succeeded (or emit a false owner alert).
          const currentIntent = await getStripe().paymentIntents.retrieve(intent.id);
          if (!autoReloadPaymentIntentMatches(currentIntent, matched.orgId, matched.attempt, false)) {
            throw new Error("Current auto-reload PaymentIntent does not match its durable attempt");
          }
          const balance = await getOrgBalance(matched.orgId);
          await applyAutoReloadPaymentIntent(
            matched.orgId,
            balance.total,
            currentIntent,
            matched.attempt,
          );
        }
      }
    }
  } catch (err) {
    console.error("[stripe-webhook] Processing failed — returning 500 so Stripe retries:", err);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
