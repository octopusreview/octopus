import Stripe from "stripe";
import { prisma } from "@octopus/db";

let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      // Pin the API version so switching Stripe accounts can't silently change
      // event/object shapes by inheriting a different account default. Matches
      // the stripe@20.4.1 SDK's generated types.
      apiVersion: "2026-02-25.clover",
    });
  }
  return _stripe;
}

// Customer IDs already confirmed to resolve in the current Stripe account, so
// the verify below runs at most ONCE per customer per process (not on every
// billing op). This holds only opaque, already-public customer IDs — no
// cross-tenant data — and is correctness-neutral: a hit merely skips a
// redundant retrieve; if a customer is deleted mid-process the downstream Stripe
// call fails exactly as it would without the cache. Bounded by active billing
// orgs per process; resets on deploy (re-verifies once per customer afterward).
const _verifiedCustomers = new Set<string>();

export async function getOrCreateStripeCustomer(orgId: string): Promise<string> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { stripeCustomerId: true, name: true, billingEmail: true, slug: true },
  });

  const priorId = org.stripeCustomerId;
  if (priorId) {
    if (_verifiedCustomers.has(priorId)) return priorId;
    // Verify the stored customer still resolves in the CURRENT account. After a
    // Stripe account switch (or a deleted customer) the old `cus_` belongs to a
    // different account and won't resolve — recreate it instead of failing every
    // checkout / portal / auto-reload call. Self-heals an account migration per
    // org with no destructive prod data wipe; the cache keeps it one-shot.
    try {
      const existing = await getStripe().customers.retrieve(priorId);
      const isDeleted = "deleted" in existing && existing.deleted === true;
      if (!isDeleted) {
        _verifiedCustomers.add(priorId);
        return priorId;
      }
      // Deleted in Stripe → fall through and create a fresh customer.
    } catch (err) {
      // Only "no such customer" justifies recreating; rethrow real errors
      // (auth/network) so they aren't masked as a missing customer.
      if (
        !(err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing")
      ) {
        throw err;
      }
    }
  }

  const customer = await getStripe().customers.create({
    name: org.name,
    email: org.billingEmail ?? undefined,
    metadata: { orgId, slug: org.slug },
  });

  // Claim the slot with a compare-and-swap: only the writer whose `priorId` still
  // matches the column wins. Two concurrent recreations (e.g. checkout +
  // auto-reload) thus can't both persist — the loser's update matches 0 rows.
  // We do NOT hold the Stripe calls inside a DB transaction (that would pin a
  // pooled connection across slow external I/O and trip Prisma's interactive-txn
  // timeout); the CAS is a single atomic write instead.
  const claimed = await prisma.organization.updateMany({
    where: { id: orgId, stripeCustomerId: priorId },
    data: { stripeCustomerId: customer.id },
  });

  if (claimed.count === 0) {
    // Lost the race: another request already replaced stripeCustomerId. Delete
    // our just-created duplicate so it doesn't orphan in Stripe, then use the
    // winner's customer.
    try {
      await getStripe().customers.del(customer.id);
    } catch {
      // Best-effort cleanup; an undeleted spare customer is harmless.
    }
    const winner = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { stripeCustomerId: true },
    });
    if (winner.stripeCustomerId) {
      _verifiedCustomers.add(winner.stripeCustomerId);
      return winner.stripeCustomerId;
    }
  }

  _verifiedCustomers.add(customer.id);
  return customer.id;
}

export async function createCheckoutSession(
  orgId: string,
  amountUsd: number,
  returnUrl: string,
): Promise<string> {
  const customerId = await getOrCreateStripeCustomer(orgId);
  const amountCents = Math.round(amountUsd * 100);

  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: {
            name: `Octopus Credits — $${amountUsd}`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: { orgId, type: "credit_purchase", amountUsd: String(amountUsd) },
    // Save the card for off-session use (auto-reload, subscription renewals).
    payment_intent_data: { setup_future_usage: "off_session" },
    success_url: `${returnUrl}?success=true`,
    cancel_url: `${returnUrl}?canceled=true`,
  });

  return session.url!;
}

/**
 * First subscription payment via Checkout for orgs with no saved card.
 * The webhook (metadata.type === "subscription_start") grants the period and
 * stamps the plan; setup_future_usage saves the card so renewals can charge
 * off-session.
 */
export async function createSubscriptionCheckoutSession(
  orgId: string,
  tier: string,
  planName: string,
  priceUsd: number,
  returnUrl: string,
): Promise<string> {
  const customerId = await getOrCreateStripeCustomer(orgId);

  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: Math.round(priceUsd * 100),
          product_data: {
            name: `Octopus ${planName} plan — first month`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: { orgId, type: "subscription_start", tier },
    payment_intent_data: { setup_future_usage: "off_session" },
    success_url: `${returnUrl}?subscribed=true`,
    cancel_url: `${returnUrl}?canceled=true`,
  });

  return session.url!;
}

export async function createPortalSession(
  orgId: string,
  returnUrl: string,
): Promise<string> {
  const customerId = await getOrCreateStripeCustomer(orgId);

  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session.url;
}

export type PaymentMethodInfo = {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

export async function getCustomerPaymentMethods(
  stripeCustomerId: string,
): Promise<PaymentMethodInfo[]> {
  try {
    const methods = await getStripe().paymentMethods.list({
      customer: stripeCustomerId,
      type: "card",
      limit: 5,
    });
    return methods.data.map((m) => ({
      brand: m.card?.brand ?? "unknown",
      last4: m.card?.last4 ?? "????",
      expMonth: m.card?.exp_month ?? 0,
      expYear: m.card?.exp_year ?? 0,
    }));
  } catch {
    return [];
  }
}

export function constructWebhookEvent(
  body: string | Buffer,
  signature: string,
): Stripe.Event {
  return getStripe().webhooks.constructEvent(
    body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!,
  );
}
