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

export async function getOrCreateStripeCustomer(orgId: string): Promise<string> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { stripeCustomerId: true, name: true, billingEmail: true, slug: true },
  });

  if (org.stripeCustomerId) {
    // Verify the stored customer still resolves in the CURRENT account. After a
    // Stripe account switch (or a deleted customer) the old `cus_` belongs to a
    // different account and won't resolve — recreate it instead of failing every
    // checkout / portal / auto-reload call. This makes an account migration
    // self-healing per org with no destructive prod data wipe.
    try {
      const existing = await getStripe().customers.retrieve(org.stripeCustomerId);
      if (!("deleted" in existing && existing.deleted)) return org.stripeCustomerId;
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

  await prisma.organization.update({
    where: { id: orgId },
    data: { stripeCustomerId: customer.id },
  });

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
    success_url: `${returnUrl}?success=true`,
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
