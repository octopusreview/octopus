import "server-only";

import type Stripe from "stripe";

/** Resolve a usable off-session card without ever returning another PM type. */
export async function resolveOffSessionCardPaymentMethodId(
  stripe: Pick<Stripe, "customers" | "paymentMethods">,
  stripeCustomerId: string,
): Promise<string | null> {
  const customer = await stripe.customers.retrieve(stripeCustomerId);
  if (customer.deleted) return null;

  const defaultMethod = customer.invoice_settings?.default_payment_method;
  if (
    defaultMethod
    && typeof defaultMethod === "object"
    && defaultMethod.type === "card"
    && (
      defaultMethod.customer === stripeCustomerId
      || (
        typeof defaultMethod.customer === "object"
        && defaultMethod.customer?.id === stripeCustomerId
      )
    )
  ) {
    return defaultMethod.id;
  }

  // A string default does not carry its type or attachment. Resolve it before
  // use, and only accept a card attached to this exact customer.
  if (typeof defaultMethod === "string") {
    try {
      const resolvedDefault = await stripe.paymentMethods.retrieve(defaultMethod);
      const attachedCustomer = resolvedDefault.customer;
      if (
        resolvedDefault.type === "card"
        && (
          attachedCustomer === stripeCustomerId
          || (
            typeof attachedCustomer === "object"
            && attachedCustomer?.id === stripeCustomerId
          )
        )
      ) {
        return resolvedDefault.id;
      }
    } catch (err) {
      // A stale deleted default is equivalent to no usable default; a real
      // Stripe/API outage must still propagate rather than look like no card.
      if ((err as { code?: unknown } | null)?.code !== "resource_missing") {
        throw err;
      }
    }
  }

  // Fall back to the first attached card. Stripe filters this server-side, so
  // there is no pagination gap and a non-card default can never leak through.
  const methods = await stripe.paymentMethods.list({
    customer: stripeCustomerId,
    type: "card",
    limit: 1,
  });
  return methods.data[0]?.id ?? null;
}
