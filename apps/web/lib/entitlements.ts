import { prisma } from "@octopus/db";
import { ORG_TYPE } from "@/lib/org-types";

/**
 * Feature entitlements for paid-only features (currently: live telemetry).
 *
 * There is no subscription/plan model — billing is credit-based (one-time
 * Stripe top-ups). "Paid" is therefore defined monotonically so it can't
 * flicker as credits are spent, and so it doesn't wrongly lock the feature
 * for legitimate non-credit payers. An org is paid when ANY of:
 *   1. self-hosted install (no billing path at all);
 *   2. FRIENDLY org type (comped / relationship tier);
 *   3. BYOK — the org runs on its own provider key(s);
 *   4. it has ever made a real purchase (purchase / auto_reload txn).
 *
 * COMMUNITY orgs are intentionally excluded — that tier is rate-limited, not
 * credit-based, and live telemetry is a paid perk.
 *
 * Mirrors the spirit of lib/cost.ts:getOrgSpendLimitStatus but is purchase-
 * history based rather than current-balance based.
 */

const IS_SELF_HOSTED = process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED === "true";

/** CreditTransaction.type values that represent a real (paid) purchase. */
const PURCHASE_TXN_TYPES = ["purchase", "auto_reload"];

/** True when the deployment is a self-hosted install (no billing path). */
export function isSelfHosted(): boolean {
  return IS_SELF_HOSTED;
}

type ProviderKeyFields = {
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  googleApiKey: string | null;
  cohereApiKey: string | null;
  grokApiKey: string | null;
  openrouterApiKey: string | null;
  claudeCodeApiKey: string | null;
};

function hasOwnProviderKey(org: ProviderKeyFields): boolean {
  return Boolean(
    org.anthropicApiKey ||
      org.openaiApiKey ||
      org.googleApiKey ||
      org.cohereApiKey ||
      org.grokApiKey ||
      org.openrouterApiKey ||
      org.claudeCodeApiKey,
  );
}

export type OrgEntitlements = {
  /** Entitled to paid-only features. */
  paid: boolean;
  /** Live telemetry is entitled AND the org owner has enabled it. */
  liveTelemetryActive: boolean;
  /** Org has opted in to letting vendor staff see member-level detail. */
  allowVendorMemberVisibility: boolean;
};

/**
 * Resolve all telemetry-relevant entitlements for an org in as few queries as
 * possible. Returns conservative defaults (everything false) for a missing org.
 */
export async function getOrgEntitlements(orgId: string): Promise<OrgEntitlements> {
  if (IS_SELF_HOSTED) {
    // Self-hosted: always entitled; the only thing that matters is whether the
    // owner enabled it. Still respects the vendor-visibility opt-in (unused on
    // self-host, where there is no vendor console — but kept consistent).
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { liveTelemetryEnabled: true, allowVendorMemberVisibility: true },
    });
    return {
      paid: true,
      liveTelemetryActive: Boolean(org?.liveTelemetryEnabled),
      allowVendorMemberVisibility: Boolean(org?.allowVendorMemberVisibility),
    };
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      type: true,
      anthropicApiKey: true,
      openaiApiKey: true,
      googleApiKey: true,
      cohereApiKey: true,
      grokApiKey: true,
      openrouterApiKey: true,
      claudeCodeApiKey: true,
      liveTelemetryEnabled: true,
      allowVendorMemberVisibility: true,
    },
  });
  if (!org) {
    return { paid: false, liveTelemetryActive: false, allowVendorMemberVisibility: false };
  }

  let paid = org.type === ORG_TYPE.FRIENDLY || hasOwnProviderKey(org);
  if (!paid) {
    const purchase = await prisma.creditTransaction.findFirst({
      where: { organizationId: orgId, type: { in: PURCHASE_TXN_TYPES } },
      select: { id: true },
    });
    paid = purchase !== null;
  }

  return {
    paid,
    liveTelemetryActive: paid && Boolean(org.liveTelemetryEnabled),
    allowVendorMemberVisibility: Boolean(org.allowVendorMemberVisibility),
  };
}

/** Whether an org is entitled to paid-only features. */
export async function isOrgPaid(orgId: string): Promise<boolean> {
  return (await getOrgEntitlements(orgId)).paid;
}

/** Whether an org may use the live-telemetry feature (entitlement only — does
 *  NOT require the toggle to be on). Use to decide whether to show the feature
 *  vs. an upgrade upsell. */
export async function canUseLiveTelemetry(orgId: string): Promise<boolean> {
  return isOrgPaid(orgId);
}

/** Whether live telemetry is actively collecting for this org: entitled AND
 *  enabled by the owner. Use to gate collection, broadcast, and subscription. */
export async function liveTelemetryActive(orgId: string): Promise<boolean> {
  return (await getOrgEntitlements(orgId)).liveTelemetryActive;
}
