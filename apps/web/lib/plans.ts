/**
 * Monthly subscription plans. Charged as off-session PaymentIntents against
 * the org's saved card (same machinery as auto-reload) — deliberately NOT
 * Stripe Billing subscriptions; see renewDueSubscriptions in subscription.ts.
 * Each period grants non-expiring credits into the unified balance; the
 * credit grant exceeds the price so subscribing beats one-off top-ups.
 */
export const SUBSCRIPTION_PLANS = {
  pro: { name: "Pro", priceUsd: 49, creditsUsd: 54 },
  team: { name: "Team", priceUsd: 99, creditsUsd: 115 },
} as const;

export type PaidPlanTier = keyof typeof SUBSCRIPTION_PLANS;

export function isPaidPlanTier(tier: string): tier is PaidPlanTier {
  return tier in SUBSCRIPTION_PLANS;
}
