import { prisma } from "@octopus/db";
import { isSharedFingerprintAbuse } from "@/lib/device-abuse";
import {
  hasOwnProviderKey,
  PURCHASE_TXN_TYPES,
  type ProviderKeyFields,
} from "@/lib/entitlements";
import { ORG_TYPE } from "@/lib/org-types";
import { WELCOME_RISK } from "@/lib/welcome-credit";

/**
 * Account-standing gate for org API tokens (signup-farm control, issue #788).
 *
 * An account is HELD when either its device fingerprint is shared across many
 * accounts (Sybil signal, see device-abuse.ts) or its org sits in the
 * welcome-risk hold/block band (welcome-credit.ts) — UNLESS the org shows a
 * real product signal (the same signals entitlements.ts treats as "paid"):
 * a provider-connected repository, a Stripe customer, a paid credit
 * transaction, FRIENDLY org type, an own provider key (BYOK), or a paid plan
 * tier. The 1,699-account farm had none of these on any org.
 */

export const ACCOUNT_HOLD_MESSAGE =
  "API tokens are not available for this account yet. Connect a repository or contact support.";

/** Org risk score in the hold-or-block band (>= holdAt covers both). */
export function isHeldRiskBand(welcomeRiskScore: number | null): boolean {
  return welcomeRiskScore !== null && welcomeRiskScore >= WELCOME_RISK.holdAt;
}

export type ProductSignalOrg = {
  id: string;
  stripeCustomerId: string | null;
  type: number;
  planTier: string;
} & ProviderKeyFields;

/**
 * True when the org shows a real product signal — the same signals
 * entitlements.ts treats as "paid": a Stripe customer, FRIENDLY org type,
 * an own provider key (BYOK), a paid plan tier, a provider-connected
 * repository, or a purchase/subscription credit transaction. CLI-created
 * repository rows (externalId "cli:<provider>:<fullName>", index-local.ts)
 * do NOT count — any token holder can mint one post-auth, which would let a
 * farm plant its own exemption. At most two single-row queries,
 * short-circuiting on the first hit.
 */
export async function orgHasProductSignal(org: ProductSignalOrg): Promise<boolean> {
  if (
    org.stripeCustomerId ||
    org.type === ORG_TYPE.FRIENDLY ||
    org.planTier !== "free" ||
    hasOwnProviderKey(org)
  ) {
    return true;
  }
  const repo = await prisma.repository.findFirst({
    where: {
      organizationId: org.id,
      NOT: { externalId: { startsWith: "cli:" } },
    },
    select: { id: true },
  });
  if (repo) return true;
  const purchase = await prisma.creditTransaction.findFirst({
    where: { organizationId: org.id, type: { in: PURCHASE_TXN_TYPES } },
    select: { id: true },
  });
  return purchase !== null;
}

const PRODUCT_SIGNAL_SELECT = {
  id: true,
  stripeCustomerId: true,
  type: true,
  planTier: true,
  anthropicApiKey: true,
  openaiApiKey: true,
  googleApiKey: true,
  cohereApiKey: true,
  grokApiKey: true,
  openrouterApiKey: true,
  alibabaApiKey: true,
  claudeCodeApiKey: true,
} as const;

export const COUPON_HOLD_MESSAGE =
  "Connect a repository before redeeming a coupon, or contact support.";

/**
 * Coupon credit lands in the paid balance, so redeeming needs a positive
 * signal, not just the absence of a hold: an OAuth sign-in (same test as the
 * welcome-credit deferral in org-create.ts) or a product signal on the org.
 */
export async function canRedeemCoupon(args: {
  userId: string;
  orgId: string;
}): Promise<boolean> {
  if ((await prisma.account.count({ where: { userId: args.userId } })) > 0) {
    return true;
  }
  const org = await prisma.organization.findUnique({
    where: { id: args.orgId },
    select: PRODUCT_SIGNAL_SELECT,
  });
  return org !== null && (await orgHasProductSignal(org));
}

export async function getAccountStanding(args: {
  userId: string;
  orgId: string;
}): Promise<{ held: boolean; reasons: string[] }> {
  const { userId, orgId } = args;

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { ...PRODUCT_SIGNAL_SELECT, welcomeRiskScore: true },
  });
  // Callers verify org membership before this gate; a missing org is theirs
  // to reject, not a hold.
  if (!org) return { held: false, reasons: [] };

  if (await orgHasProductSignal(org)) return { held: false, reasons: [] };

  const reasons: string[] = [];

  if (isHeldRiskBand(org.welcomeRiskScore)) {
    reasons.push("welcome_risk_hold");
  }

  // Shared-fingerprint check across ALL of the user's devices in one grouped
  // query (per-fingerprint countUsersSharingFingerprint would be N+1). Rows
  // are unique per (user, fingerprint), so each group count is the number of
  // OTHER accounts sharing that fingerprint — same semantics, same
  // SHARED_FINGERPRINT_THRESHOLD (device-abuse.ts).
  const devices = await prisma.userDevice.findMany({
    where: { userId },
    select: { fingerprint: true },
  });
  if (devices.length > 0) {
    const shared = await prisma.userDevice.groupBy({
      by: ["fingerprint"],
      where: {
        fingerprint: { in: devices.map((d) => d.fingerprint) },
        userId: { not: userId },
      },
      _count: { fingerprint: true },
    });
    const maxShared = shared.reduce(
      (max, group) => Math.max(max, group._count.fingerprint),
      0,
    );
    if (isSharedFingerprintAbuse(maxShared)) {
      reasons.push(`shared_fingerprint_${maxShared}`);
    }
  }

  return { held: reasons.length > 0, reasons };
}
