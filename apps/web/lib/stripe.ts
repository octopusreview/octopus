// STUB: Stripe billing disabled for Databricks demo deployment.
// Gated on FEATURES_BILLING=true. Re-enable by setting the flag and the STRIPE_SECRET_KEY secret.
import Stripe from "stripe";
import { prisma } from "@octopus/db";

const billingEnabled = process.env.FEATURES_BILLING === "true";

let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (!billingEnabled) {
    throw new Error(
      "Stripe is disabled in this deployment (FEATURES_BILLING=false). Set FEATURES_BILLING=true and STRIPE_SECRET_KEY to enable.",
    );
  }
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  return _stripe;
}

export async function getOrCreateStripeCustomer(orgId: string): Promise<string> {
  if (!billingEnabled) {
    throw new Error("Stripe is disabled in this deployment (FEATURES_BILLING=false)");
  }
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { stripeCustomerId: true, name: true, billingEmail: true, slug: true },
  });

  if (org.stripeCustomerId) return org.stripeCustomerId;

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
  if (!billingEnabled) {
    throw new Error("Stripe is disabled in this deployment (FEATURES_BILLING=false)");
  }
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
  if (!billingEnabled) {
    throw new Error("Stripe is disabled in this deployment (FEATURES_BILLING=false)");
  }
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
  if (!billingEnabled) return [];
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
  if (!billingEnabled) {
    throw new Error("Stripe is disabled in this deployment (FEATURES_BILLING=false)");
  }
  return getStripe().webhooks.constructEvent(
    body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!,
  );
}

export function isBillingEnabled(): boolean {
  return billingEnabled;
}
