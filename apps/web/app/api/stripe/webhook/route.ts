import { NextRequest, NextResponse } from "next/server";
import { constructWebhookEvent, getStripe } from "@/lib/stripe";
import { addCredits, deductCredits } from "@/lib/credits";
import { grantSubscriptionPeriod, addOneMonth } from "@/lib/subscription";
import { isPaidPlanTier } from "@/lib/plans";
import { prisma } from "@octopus/db";

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
        // Find the org via the checkout session tied to this payment intent.
        const sessions = await getStripe().checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
        const orgId = sessions.data[0]?.metadata?.orgId;

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

    if (event.type === "payment_intent.payment_failed") {
      const intent = event.data.object;
      console.error("[stripe-webhook] Payment failed:", intent.id, intent.last_payment_error?.message);
    }
  } catch (err) {
    console.error("[stripe-webhook] Processing failed — returning 500 so Stripe retries:", err);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
