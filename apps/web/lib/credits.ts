import "server-only";

import { prisma, type Prisma } from "@octopus/db";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { getStripe, getOffSessionPaymentMethodId } from "./stripe";
import { eventBus } from "./events/bus";
import { volumeBonusUsd } from "./plans";

export type OffSessionPurchaseResult =
  | { status: "succeeded"; paymentIntentId: string }
  | { status: "no_card" }
  // `cardError` distinguishes a genuine card decline (show the user "card
  // declined, update it") from a platform/Stripe-side failure — bad config,
  // auth, network, unexpected PI status — which must NOT be blamed on the
  // customer's card. `reason` carries the Stripe error code when available.
  | { status: "failed"; cardError: boolean; reason?: string };

/** True when a caught Stripe error is a genuine card decline, not our-side. */
function isStripeCardError(err: unknown): boolean {
  const e = err as { type?: unknown; rawType?: unknown } | null;
  return e?.type === "StripeCardError" || e?.rawType === "card_error";
}

function isDuplicateLedgerError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "P2002";
}

/**
 * Grant credits for a succeeded off-session credit-purchase PaymentIntent:
 * the purchase amount plus the volume bonus, keyed on the PI id so it runs
 * AT MOST ONCE across the inline fast-path and the webhook backfill. Safe to
 * call from either; a second call (already granted) is a P2002 no-op.
 */
export async function grantPurchaseFromPaymentIntent(
  orgId: string,
  amountUsd: number,
  paymentIntentId: string,
  latestCharge: string | { id: string } | null,
): Promise<void> {
  try {
    await addCredits(orgId, amountUsd, "purchase", `Credit purchase — $${amountUsd}`, paymentIntentId);
  } catch (err) {
    if (isDuplicateLedgerError(err)) return; // already granted for this PI
    throw err;
  }

  // Reached only on the first (non-duplicate) grant, so the bonus lands once.
  const bonus = volumeBonusUsd(amountUsd);
  if (bonus > 0) {
    await addFreeCredits(orgId, bonus, `Volume bonus — $${bonus} on $${amountUsd} purchase`);
  }

  // Best-effort receipt backfill — credits already committed.
  const chargeId = typeof latestCharge === "string" ? latestCharge : latestCharge?.id;
  if (chargeId) {
    try {
      const chargeObj = await getStripe().charges.retrieve(chargeId);
      if (chargeObj.receipt_url) {
        await prisma.creditTransaction.update({
          where: { stripeSessionId: paymentIntentId },
          data: { receiptUrl: chargeObj.receipt_url },
        });
      }
    } catch {
      /* non-critical */
    }
  }
}

/**
 * Grant credits for a succeeded auto-reload PaymentIntent. The PI id is the
 * durable ledger key, so the inline fast-path and Stripe webhook recovery can
 * both call this without double-granting.
 */
export async function grantAutoReloadFromPaymentIntent(
  orgId: string,
  amountUsd: number,
  paymentIntentId: string,
  latestCharge: string | { id: string } | null,
  attempt?: { id: string; idempotencyKey: string },
): Promise<void> {
  let duplicateGrant = false;
  try {
    await addCredits(
      orgId,
      amountUsd,
      "auto_reload",
      `Auto-reload — $${amountUsd}`,
      paymentIntentId,
    );
  } catch (err) {
    if (isDuplicateLedgerError(err)) {
      duplicateGrant = true;
    } else {
      throw err;
    }
  }

  // Keep the durable attempt active until the value-bearing ledger grant has
  // committed. A webhook racing the inline path may observe a duplicate ledger
  // row, but it must still be allowed to close the same attempt.
  if (attempt) {
    const completion = await prisma.autoReloadAttempt.updateMany({
      where: {
        id: attempt.id,
        organizationId: orgId,
        idempotencyKey: attempt.idempotencyKey,
        status: { in: ["initializing", "pending", "submitting", "processing", "charged", "failed", "uncertain"] },
      },
      data: {
        status: "completed",
        activeOrganizationId: null,
        stripePaymentIntentId: paymentIntentId,
        failureReason: null,
        completedAt: new Date(),
      },
    });

    if (completion.count !== 1) {
      const completed = await prisma.autoReloadAttempt.findFirst({
        where: {
          id: attempt.id,
          organizationId: orgId,
          idempotencyKey: attempt.idempotencyKey,
          stripePaymentIntentId: paymentIntentId,
          status: "completed",
        },
        select: { id: true },
      });
      if (!completed) {
        throw new Error("Auto-reload grant committed but its durable attempt could not be completed");
      }
    }
  }

  if (duplicateGrant) {
    return;
  }

  // Best-effort receipt backfill — credits already committed.
  const chargeId = typeof latestCharge === "string" ? latestCharge : latestCharge?.id;
  if (chargeId) {
    try {
      const chargeObj = await getStripe().charges.retrieve(chargeId);
      if (chargeObj.receipt_url) {
        await prisma.creditTransaction.update({
          where: { stripeSessionId: paymentIntentId },
          data: { receiptUrl: chargeObj.receipt_url },
        });
      }
    } catch {
      /* non-critical */
    }
  }
}

/** Finalize a matching durable attempt after Stripe reports PI failure. */
export async function failAutoReloadAttemptFromPaymentIntent(
  orgId: string,
  paymentIntentId: string,
  attempt: { id: string; idempotencyKey: string },
  reason?: string,
): Promise<boolean> {
  const now = new Date();
  const failure = await prisma.autoReloadAttempt.updateMany({
    where: {
      id: attempt.id,
      organizationId: orgId,
      idempotencyKey: attempt.idempotencyKey,
      activeOrganizationId: orgId,
      // State transitions are monotonic: a failure snapshot may arrive after a
      // succeeded event, so it must never demote a charged/completed attempt.
      status: { in: ["submitting", "processing", "uncertain"] },
    },
    data: {
      status: "failed",
      stripePaymentIntentId: paymentIntentId,
      failureReason: reason ?? "payment_failed",
      leaseExpiresAt: new Date(now.getTime() + AUTO_RELOAD_LEASE_MS),
      completedAt: now,
    },
  });

  if (failure.count === 1) return true;

  const terminal = await prisma.autoReloadAttempt.findFirst({
    where: {
      id: attempt.id,
      organizationId: orgId,
      idempotencyKey: attempt.idempotencyKey,
      status: { in: ["charged", "completed", "failed", "disabled"] },
    },
    select: { id: true, status: true, stripePaymentIntentId: true },
  });
  if (!terminal || (terminal.stripePaymentIntentId && terminal.stripePaymentIntentId !== paymentIntentId)) {
    throw new Error("Failed auto-reload PaymentIntent lost its durable attempt claim");
  }

  if (terminal.status !== "failed") return false;

  // The synchronous Stripe error may have conclusively marked the attempt
  // failed before exposing a PI id. Backfill it from the signed webhook without
  // treating the duplicate failure as a new owner-notification transition.
  if (!terminal.stripePaymentIntentId) {
    await prisma.autoReloadAttempt.updateMany({
      where: {
        id: attempt.id,
        organizationId: orgId,
        idempotencyKey: attempt.idempotencyKey,
        stripePaymentIntentId: null,
        status: "failed",
      },
      data: { stripePaymentIntentId: paymentIntentId },
    });
  }
  return false;
}

/**
 * Charge the org's saved card off-session for a one-off credit top-up and
 * grant the credits inline — no Stripe Checkout redirect. Mirrors the
 * auto-reload/subscription off-session charge. The inline grant provides
 * immediate feedback and payment_intent.succeeded is the recovery path; both
 * are keyed on the PaymentIntent id (unique stripeSessionId), so they cannot
 * double-grant. Returns "no_card" when there's nothing saved (caller falls
 * back to Checkout), "failed" on decline/Stripe error.
 */
export async function chargeCreditsOffSession(
  orgId: string,
  amountUsd: number,
  // Deterministic per user-initiated purchase: the Stripe SDK reuses it across
  // its own network retries of the create() call, so a blip can't double-charge.
  // Distinct clicks pass distinct keys, so intentional repeat purchases still go
  // through.
  idempotencyKey: string,
): Promise<OffSessionPurchaseResult> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { stripeCustomerId: true },
  });
  if (!org?.stripeCustomerId) return { status: "no_card" };

  let paymentMethod: string | null;
  try {
    paymentMethod = await getOffSessionPaymentMethodId(org.stripeCustomerId);
  } catch (err) {
    // Failing to look up the saved card is a platform/Stripe-side error, not a
    // decline — don't tell the customer their card was declined.
    console.error("[credits] Off-session payment-method lookup failed:", err);
    return { status: "failed", cardError: false };
  }
  if (!paymentMethod) return { status: "no_card" };

  let paymentIntent;
  try {
    paymentIntent = await getStripe().paymentIntents.create(
      {
        amount: Math.round(amountUsd * 100),
        currency: "usd",
        customer: org.stripeCustomerId,
        payment_method: paymentMethod,
        off_session: true,
        confirm: true,
        metadata: { orgId, type: "credit_purchase", amountUsd: String(amountUsd) },
      },
      { idempotencyKey },
    );
  } catch (err) {
    const e = err as { code?: unknown; type?: unknown } | null;
    const code = e?.code;
    const cardError = isStripeCardError(err);
    // Log type + code so platform-side failures (auth/config/network) are
    // greppable in prod logs and not silently blamed on the customer's card.
    console.error("[credits] Off-session purchase charge failed:", { type: e?.type, code, cardError, err });
    return { status: "failed", cardError, reason: typeof code === "string" ? code : undefined };
  }
  // A non-succeeded PI after off_session confirm (e.g. requires_action/
  // requires_payment_method) is not a clean decline; treat as platform-side so
  // we surface a neutral message and can inspect the status in logs.
  if (paymentIntent.status !== "succeeded") {
    console.error("[credits] Off-session purchase PI not succeeded:", paymentIntent.status);
    return { status: "failed", cardError: false, reason: paymentIntent.status };
  }

  // Grant inline for instant feedback. This is a FAST PATH: the authoritative
  // guarantee is the payment_intent.succeeded webhook, which grants the same
  // amount keyed on the same PI id (P2002-idempotent). So if this process dies
  // between charge and grant, the webhook still delivers the credits — the
  // customer can never be charged without receiving them. A duplicate here
  // (webhook already granted) is a benign no-op.
  await grantPurchaseFromPaymentIntent(orgId, amountUsd, paymentIntent.id, paymentIntent.latest_charge);

  return { status: "succeeded", paymentIntentId: paymentIntent.id };
}

export async function getOrgBalance(orgId: string) {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { creditBalance: true, freeCreditBalance: true },
  });

  const free = Number(org.freeCreditBalance);
  const purchased = Number(org.creditBalance);

  return { free, purchased, total: free + purchased };
}

export async function addCredits(
  orgId: string,
  amount: number,
  type: string,
  description?: string,
  stripeSessionId?: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const org = await tx.organization.update({
      where: { id: orgId },
      data: { creditBalance: { increment: amount } },
      select: { creditBalance: true, freeCreditBalance: true },
    });

    const totalAfter = Number(org.creditBalance) + Number(org.freeCreditBalance);

    await tx.creditTransaction.create({
      data: {
        amount,
        type,
        description,
        stripeSessionId,
        balanceAfter: totalAfter,
        organizationId: orgId,
      },
    });
  });
}

export async function addFreeCredits(
  orgId: string,
  amount: number,
  description: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const org = await tx.organization.update({
      where: { id: orgId },
      data: { freeCreditBalance: { increment: amount } },
      select: { creditBalance: true, freeCreditBalance: true },
    });

    const totalAfter = Number(org.creditBalance) + Number(org.freeCreditBalance);

    await tx.creditTransaction.create({
      data: {
        amount,
        type: "free_credit",
        description,
        balanceAfter: totalAfter,
        organizationId: orgId,
      },
    });
  });
}

export async function deductCredits(
  orgId: string,
  amount: number,
  description: string,
  // When set (refund path), the ledger row carries this id under a UNIQUE
  // column so a replayed/duplicate refund event hits a constraint violation and
  // the whole transaction rolls back instead of debiting twice. Left undefined
  // for ordinary usage deductions (which are intentionally non-unique).
  stripeRefundId?: string,
): Promise<void> {
  if (amount <= 0) return;

  const deduction = await prisma.$transaction(async (tx): Promise<{
    totalAfter: number;
    durableClaim: DurableAutoReloadClaim | null;
  }> => {
    // Lock the row to prevent race conditions
    const rows = await tx.$queryRaw<
      Array<{ creditBalance: number; freeCreditBalance: number }>
    >`SELECT "creditBalance"::float, "freeCreditBalance"::float FROM organizations WHERE id = ${orgId} FOR UPDATE`;

    if (rows.length === 0) return { totalAfter: 0, durableClaim: null };

    const free = rows[0].freeCreditBalance;
    const purchased = rows[0].creditBalance;

    let newFree: number;
    let newPurchased: number;

    if (amount <= free) {
      newFree = free - amount;
      newPurchased = purchased;
    } else {
      const remainder = amount - free;
      newFree = 0;
      newPurchased = purchased - remainder;
    }

    const totalAfter = newFree + newPurchased;

    await tx.organization.update({
      where: { id: orgId },
      data: {
        freeCreditBalance: newFree,
        creditBalance: newPurchased,
      },
    });

    await tx.creditTransaction.create({
      data: {
        amount: -amount,
        type: "usage",
        description,
        stripeRefundId,
        balanceAfter: totalAfter,
        organizationId: orgId,
      },
    });

    // Make the value deduction and its reload work claim one atomic commit.
    // A process crash can now leave either both rows or neither row, never a
    // low-balance ledger entry with no durable recovery work.
    const durableClaim = !stripeRefundId
      ? await ensureDurableAutoReloadAttempt(orgId, totalAfter, tx)
      : null;
    return { totalAfter, durableClaim };
  });

  await maybeNotifyCreditLow(orgId, deduction.totalAfter);

  // External Stripe I/O remains off the deduction hot path. At this point the
  // attempt is durable; if this best-effort kick is interrupted, pg-boss safely
  // reclaims its expired lease.
  if (deduction.durableClaim?.readyToProcess) {
    void processDurableAutoReloadAttempt(
      orgId,
      deduction.totalAfter,
      deduction.durableClaim.attempt,
    ).catch((err) =>
      console.error("[credits] Auto-reload processing failed:", err),
    );
  }
}

// Minimum low-credit threshold for slow/steady usage; preserves the original
// $10 warning floor so nothing regresses for low-volume orgs.
const CREDIT_LOW_FLOOR = 10; // dollars
// Window used to estimate the org's recent burn rate.
const BURN_LOOKBACK_MS = 60 * 60 * 1000; // 1 hour
// Skip the burn-rate query entirely for well-funded orgs to keep the
// deduction hot path cheap. Orgs above this balance never need a warning;
// the next deduction that drops them below it will re-evaluate.
const BURN_QUERY_CEILING = 100; // dollars
// An unresolved attempt owns this short worker lease. If a process disappears,
// another worker can retry with the exact persisted Stripe parameters and key.
const AUTO_RELOAD_LEASE_MS = 5 * 60 * 1000;
// Conclusive failures back off exponentially per recent failure, so a
// permanently declining card settles at a few attempts per day instead of one
// new PaymentIntent per lease. An explicit owner retry bypasses the cooldown.
const AUTO_RELOAD_FAILURE_BACKOFF_WINDOW_MS = 24 * 60 * 60 * 1000;
const AUTO_RELOAD_FAILURE_MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
// Stripe retains idempotency results for at least 24 hours. Stop automatic
// retries just before that boundary rather than risk reusing a pruned key.
const AUTO_RELOAD_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
// An empty Stripe list is checked again only after every submission has had a
// full hour to settle. This separates "not found" from a request whose response
// was lost while Stripe may still be completing it.
const AUTO_RELOAD_SUBMISSION_SETTLE_MS = 60 * 60 * 1000;
// Keep each scheduled reconciliation run bounded. Expired leases are ordered
// oldest-first, and every claimed row moves its lease forward so later batches
// cannot be starved by one repeatedly failing attempt.
const AUTO_RELOAD_RECONCILE_BATCH_SIZE = 100;

export type AutoReloadAttemptIdentity = {
  id: string;
  idempotencyKey: string;
  amountCents: number;
  stripeCustomerId: string;
  stripePaymentMethodId: string | null;
  stripePaymentIntentId: string | null;
};

type AutoReloadAttemptState = AutoReloadAttemptIdentity & {
  organizationId: string;
  status: string;
  leaseExpiresAt: Date;
  retryUntil: Date;
  lastSubmittedAt: Date | null;
  createdAt: Date;
  completedAt: Date | null;
  failureReason: string | null;
};

type DurableAutoReloadClaim = {
  attempt: AutoReloadAttemptState;
  readyToProcess: boolean;
};

type AutoReloadStore = Pick<
  Prisma.TransactionClient,
  "autoReloadConfig" | "organization" | "autoReloadAttempt"
>;

/**
 * Emit a `credit-low` event when the balance can no longer cover the org's
 * projected next hour of usage. The threshold adapts to burn rate: a fast
 * burner is warned with roughly an hour of runway left, while a slow/steady
 * org keeps the original $10 floor.
 */
async function maybeNotifyCreditLow(
  orgId: string,
  totalAfter: number,
): Promise<void> {
  if (totalAfter <= 0 || totalAfter >= BURN_QUERY_CEILING) return;

  // Sum of usage over the last hour. Usage amounts are stored negative, so the
  // absolute value is dollars-per-hour at the recent pace.
  const recent = await prisma.creditTransaction.aggregate({
    where: {
      organizationId: orgId,
      type: "usage",
      createdAt: { gte: new Date(Date.now() - BURN_LOOKBACK_MS) },
    },
    _sum: { amount: true },
  });

  const burnPerHour = Math.abs(Number(recent._sum.amount ?? 0));
  // Warn once the balance can't fund the next projected hour, never below the floor.
  const threshold = Math.max(CREDIT_LOW_FLOOR, burnPerHour);

  if (totalAfter >= threshold) return;

  eventBus.emit({
    type: "credit-low",
    orgId,
    remainingBalance: totalAfter,
    burnRatePerHour: burnPerHour,
    runwayMinutes: burnPerHour > 0 ? (totalAfter / burnPerHour) * 60 : undefined,
  });
}

function isValidAutoReloadConfig(threshold: number, reloadAmount: number): boolean {
  return Number.isFinite(threshold)
    && threshold >= 1
    && threshold <= 1000
    && Number.isFinite(reloadAmount)
    && reloadAmount >= 5
    && reloadAmount <= 1000;
}

export function stripeObjectId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

export function autoReloadPaymentIntentMatches(
  intent: Stripe.PaymentIntent,
  orgId: string,
  attempt: AutoReloadAttemptIdentity,
  requireReceivedAmount: boolean,
): boolean {
  const paymentMethodId = stripeObjectId(intent.payment_method)
    ?? stripeObjectId(intent.last_payment_error?.payment_method);
  return intent.metadata?.orgId === orgId
    && intent.metadata?.type === "auto_reload"
    && intent.metadata?.autoReloadAttemptId === attempt.id
    && intent.metadata?.autoReloadKey === attempt.idempotencyKey
    && intent.currency === "usd"
    && intent.amount === attempt.amountCents
    && (!requireReceivedAmount || intent.amount_received === attempt.amountCents)
    && stripeObjectId(intent.customer) === attempt.stripeCustomerId
    && Boolean(attempt.stripePaymentMethodId)
    && paymentMethodId === attempt.stripePaymentMethodId
    && (!attempt.stripePaymentIntentId || attempt.stripePaymentIntentId === intent.id);
}

export function isTerminalAutoReloadPaymentIntentStatus(status: string): boolean {
  return status === "canceled";
}

function shouldCancelUnresolvedAutoReloadPaymentIntent(
  intent: Stripe.PaymentIntent,
  attempt: AutoReloadAttemptState,
): boolean {
  return intent.status === "requires_payment_method"
    || intent.status === "requires_action"
    || attempt.retryUntil <= new Date();
}

async function createDurableAutoReloadAttempt(
  orgId: string,
  currentBalance: number,
  now: Date,
  store: AutoReloadStore,
): Promise<AutoReloadAttemptState | null> {
  const config = await store.autoReloadConfig.findUnique({
    where: { organizationId: orgId },
  });
  if (!config?.enabled) return null;

  const threshold = Number(config.thresholdAmount);
  const reloadAmount = Number(config.reloadAmount);
  if (!isValidAutoReloadConfig(threshold, reloadAmount)) {
    console.error("[credits] Refusing auto-reload with invalid persisted configuration", { orgId });
    return null;
  }
  if (currentBalance > threshold) return null;

  const org = await store.organization.findUnique({
    where: { id: orgId },
    select: {
      stripeCustomerId: true,
      creditBalance: true,
      freeCreditBalance: true,
    },
  });
  if (!org?.stripeCustomerId) return null;

  const liveBalance = Number(org.creditBalance) + Number(org.freeCreditBalance);
  if (liveBalance > threshold) return null;

  const attemptId = randomUUID();
  const idempotencyKey = `auto-reload-${attemptId}`;
  const data = {
    id: attemptId,
    organizationId: orgId,
    activeOrganizationId: orgId,
    status: "initializing",
    idempotencyKey,
    amountCents: Math.round(reloadAmount * 100),
    stripeCustomerId: org.stripeCustomerId,
    stripePaymentMethodId: null,
    // Immediately claimable by the local kick or the next scheduled sweep.
    leaseExpiresAt: now,
    // Armed from the first actual Stripe submission, not claim creation.
    retryUntil: now,
    lastSubmittedAt: null,
    createdAt: now,
  };
  // ON CONFLICT DO NOTHING is safe inside the usage-ledger transaction. A
  // caught unique violation would leave PostgreSQL's transaction aborted.
  const inserted = await store.autoReloadAttempt.createMany({
    data,
    skipDuplicates: true,
  });
  if (inserted.count !== 1) return null;
  return {
    ...data,
    stripePaymentIntentId: null,
    completedAt: null,
    failureReason: null,
  };
}

async function ensureDurableAutoReloadAttempt(
  orgId: string,
  currentBalance: number,
  store: AutoReloadStore = prisma,
): Promise<DurableAutoReloadClaim | null> {
  const now = new Date();
  const existing = await store.autoReloadAttempt.findUnique({
    where: { activeOrganizationId: orgId },
  }) as AutoReloadAttemptState | null;

  if (existing) {
    if (existing.status !== "failed" || existing.leaseExpiresAt > now) {
      return {
        attempt: existing,
        readyToProcess: existing.status !== "failed" && existing.leaseExpiresAt <= now,
      };
    }

    // A conclusive failure cools down before fresh customer activity can
    // release it. The cooldown doubles with every recent failure so ongoing
    // usage against a dead card cannot arm hundreds of new charges per day.
    const failedAt = existing.completedAt ?? existing.leaseExpiresAt;
    const recentFailures = await store.autoReloadAttempt.count({
      where: {
        organizationId: orgId,
        status: "failed",
        completedAt: {
          gte: new Date(failedAt.getTime() - AUTO_RELOAD_FAILURE_BACKOFF_WINDOW_MS),
        },
      },
    });
    const backoffMs = Math.min(
      AUTO_RELOAD_LEASE_MS * 2 ** Math.max(recentFailures - 1, 0),
      AUTO_RELOAD_FAILURE_MAX_BACKOFF_MS,
    );
    if (new Date(failedAt.getTime() + backoffMs) > now) {
      return { attempt: existing, readyToProcess: false };
    }

    const released = await store.autoReloadAttempt.updateMany({
      where: {
        id: existing.id,
        activeOrganizationId: orgId,
        status: "failed",
        leaseExpiresAt: { lte: now },
      },
      data: { activeOrganizationId: null },
    });
    if (released.count !== 1) return null;
  }

  const created = await createDurableAutoReloadAttempt(orgId, currentBalance, now, store);
  return created ? { attempt: created, readyToProcess: true } : null;
}

async function lockAutoReloadOrganization(
  tx: Prisma.TransactionClient,
  orgId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<
    Array<{ creditBalance: number; freeCreditBalance: number }>
  >`SELECT "creditBalance"::float, "freeCreditBalance"::float FROM organizations WHERE id = ${orgId} FOR UPDATE`;
  if (rows.length !== 1) {
    throw new Error("Organization not found while updating auto-reload");
  }
  return Number(rows[0].creditBalance) + Number(rows[0].freeCreditBalance);
}

function kickDurableAutoReloadClaim(
  orgId: string,
  currentBalance: number,
  claim: DurableAutoReloadClaim | null,
): void {
  if (!claim?.readyToProcess) return;
  void processDurableAutoReloadAttempt(orgId, currentBalance, claim.attempt).catch((err) =>
    console.error("[credits] Auto-reload processing failed:", err),
  );
}

/**
 * Persist the owner setting and its first low-balance work claim atomically.
 * Disabling cancels only rows that the pre-I/O state boundary proves have never
 * reached Stripe. In-flight/unknown/value-bearing attempts remain recoverable.
 */
export async function updateAutoReloadConfigDurably(
  orgId: string,
  enabled: boolean,
  thresholdAmount: number,
  reloadAmount: number,
): Promise<void> {
  if (!isValidAutoReloadConfig(thresholdAmount, reloadAmount)) {
    throw new Error("Invalid auto-reload configuration");
  }

  const failedSettlement = enabled
    ? await settleFailedAutoReloadForOwnerRetry(orgId)
    : { safeFailedAttemptId: null, completed: false };
  let currentBalance = 0;
  const claim = await prisma.$transaction(async (tx) => {
    currentBalance = await lockAutoReloadOrganization(tx, orgId);
    await tx.autoReloadConfig.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        enabled,
        pausedForDurableUpgrade: false,
        thresholdAmount,
        reloadAmount,
      },
      update: {
        enabled,
        pausedForDurableUpgrade: false,
        thresholdAmount,
        reloadAmount,
      },
    });

    if (!enabled) {
      await tx.autoReloadAttempt.updateMany({
        where: {
          activeOrganizationId: orgId,
          status: { in: ["initializing", "pending"] },
          stripePaymentIntentId: null,
          lastSubmittedAt: null,
        },
        data: {
          status: "disabled",
          activeOrganizationId: null,
          failureReason: "auto_reload_disabled",
          completedAt: new Date(),
        },
      });
      return null;
    }

    if (failedSettlement.safeFailedAttemptId) {
      await tx.autoReloadAttempt.updateMany({
        where: {
          id: failedSettlement.safeFailedAttemptId,
          activeOrganizationId: orgId,
          status: "failed",
        },
        data: {
          status: "disabled",
          activeOrganizationId: null,
          failureReason: "owner_retry_requested",
          completedAt: new Date(),
        },
      });
    }

    if (failedSettlement.completed) return null;
    return ensureDurableAutoReloadAttempt(orgId, currentBalance, tx);
  });

  // The transaction above is the durability guarantee. This local kick only
  // reduces latency; an interrupted process is recovered by the lease sweep.
  kickDurableAutoReloadClaim(orgId, currentBalance, claim);
}

async function findPersistedAutoReloadPaymentIntent(
  attempt: AutoReloadAttemptState,
): Promise<Stripe.PaymentIntent | null> {
  if (!attempt.stripePaymentMethodId) return null;

  if (attempt.stripePaymentIntentId) {
    const intent = await getStripe().paymentIntents.retrieve(attempt.stripePaymentIntentId);
    if (!autoReloadPaymentIntentMatches(intent, attempt.organizationId, attempt, false)) {
      throw new Error("Persisted auto-reload PaymentIntent no longer matches its durable attempt");
    }
    return intent;
  }

  // Stripe Search is eventually consistent, so an empty result cannot prove
  // that an in-flight create did not land. The normal customer-scoped list API
  // is the recovery source; paginate the bounded attempt window and validate
  // every financial field locally.
  const createdGte = Math.max(
    0,
    Math.floor((attempt.createdAt.getTime() - 5 * 60 * 1000) / 1000),
  );
  const matches: Stripe.PaymentIntent[] = [];
  let examined = 0;
  for await (const intent of getStripe().paymentIntents.list({
    customer: attempt.stripeCustomerId,
    // Deliberately omit `lte`: a host clock that trails Stripe must not hide a
    // just-created PI and incorrectly authorize a replacement charge.
    created: { gte: createdGte },
    limit: 100,
  })) {
    examined += 1;
    if (examined > 10_000) {
      throw new Error("Stripe auto-reload recovery window exceeded its safety bound");
    }
    if (autoReloadPaymentIntentMatches(intent, attempt.organizationId, attempt, false)) {
      matches.push(intent);
    }
  }
  if (matches.length > 1) {
    throw new Error("Stripe listed multiple matching auto-reload PaymentIntents");
  }
  return matches[0] ?? null;
}

async function settleFailedAutoReloadForOwnerRetry(orgId: string): Promise<{
  safeFailedAttemptId: string | null;
  completed: boolean;
}> {
  const observed = await prisma.autoReloadAttempt.findUnique({
    where: { activeOrganizationId: orgId },
  }) as AutoReloadAttemptState | null;
  if (observed?.status !== "failed") {
    return { safeFailedAttemptId: null, completed: false };
  }
  if (!observed.lastSubmittedAt) {
    return { safeFailedAttemptId: observed.id, completed: false };
  }
  if (!observed.stripePaymentMethodId) {
    throw new Error("Submitted failed auto-reload attempt has no payment method");
  }

  let intent = await findPersistedAutoReloadPaymentIntent(observed);
  if (intent && intent.status !== "succeeded" && intent.status !== "canceled") {
    try {
      intent = await getStripe().paymentIntents.cancel(intent.id);
    } catch {
      // Cancellation can race completion. Only an explicit terminal reread
      // permits the old attempt to be retired or considered granted.
      intent = await getStripe().paymentIntents.retrieve(intent.id);
      if (intent.status !== "succeeded" && intent.status !== "canceled") {
        throw new Error("Previous auto-reload PaymentIntent is still active");
      }
    }
  }
  if (!intent) return { safeFailedAttemptId: observed.id, completed: false };

  const balance = await getOrgBalance(orgId);
  const outcome = await applyAutoReloadPaymentIntent(
    orgId,
    balance.total,
    intent,
    observed,
  );
  return outcome === "completed"
    ? { safeFailedAttemptId: null, completed: true }
    : { safeFailedAttemptId: observed.id, completed: false };
}

/**
 * A newly saved card is an explicit owner retry. Retire only an attempt whose
 * state is proven pre-submission, or a failed attempt after Stripe confirms the
 * old request is terminal/absent; then atomically arm a replacement if needed.
 */
export async function rearmAutoReloadAfterPaymentMethodChange(orgId: string): Promise<void> {
  const failedSettlement = await settleFailedAutoReloadForOwnerRetry(orgId);
  if (failedSettlement.completed) return;
  let currentBalance = 0;
  const claim = await prisma.$transaction(async (tx) => {
    currentBalance = await lockAutoReloadOrganization(tx, orgId);
    await tx.autoReloadAttempt.updateMany({
      where: {
        activeOrganizationId: orgId,
        OR: [
          {
            status: { in: ["initializing", "pending"] },
            stripePaymentIntentId: null,
            lastSubmittedAt: null,
          },
          ...(failedSettlement.safeFailedAttemptId
            ? [{ id: failedSettlement.safeFailedAttemptId, status: "failed" }]
            : []),
        ],
      },
      data: {
        status: "disabled",
        activeOrganizationId: null,
        failureReason: "payment_method_replaced",
        completedAt: new Date(),
      },
    });
    return ensureDurableAutoReloadAttempt(orgId, currentBalance, tx);
  });

  kickDurableAutoReloadClaim(orgId, currentBalance, claim);
}

export async function applyAutoReloadPaymentIntent(
  orgId: string,
  currentBalance: number,
  intent: Stripe.PaymentIntent,
  attempt: AutoReloadAttemptIdentity,
): Promise<"active" | "completed" | "failed"> {
  if (!autoReloadPaymentIntentMatches(intent, orgId, attempt, false)) {
    throw new Error("Auto-reload PaymentIntent does not match its durable attempt");
  }

  if (intent.status === "succeeded") {
    if (intent.amount_received !== attempt.amountCents) {
      throw new Error("Succeeded auto-reload PaymentIntent has an unexpected received amount");
    }

    const charged = await prisma.autoReloadAttempt.updateMany({
      where: {
        id: attempt.id,
        organizationId: orgId,
        idempotencyKey: attempt.idempotencyKey,
        status: { in: ["initializing", "pending", "submitting", "processing", "failed", "uncertain", "disabled"] },
        OR: [
          { stripePaymentIntentId: null },
          { stripePaymentIntentId: intent.id },
        ],
      },
      data: {
        status: "charged",
        stripePaymentIntentId: intent.id,
        failureReason: null,
      },
    });

    if (charged.count !== 1) {
      const terminal = await prisma.autoReloadAttempt.findFirst({
        where: {
          id: attempt.id,
          organizationId: orgId,
          idempotencyKey: attempt.idempotencyKey,
          stripePaymentIntentId: intent.id,
          status: { in: ["charged", "completed"] },
        },
        select: { status: true },
      });
      if (!terminal) {
        throw new Error("Succeeded auto-reload PaymentIntent lost its durable attempt claim");
      }
      if (terminal.status === "completed") return "completed";
    }

    await grantAutoReloadFromPaymentIntent(
      orgId,
      attempt.amountCents / 100,
      intent.id,
      intent.latest_charge,
      { id: attempt.id, idempotencyKey: attempt.idempotencyKey },
    );
    return "completed";
  }

  if (isTerminalAutoReloadPaymentIntentStatus(intent.status)) {
    const transitioned = await failAutoReloadAttemptFromPaymentIntent(
      orgId,
      intent.id,
      { id: attempt.id, idempotencyKey: attempt.idempotencyKey },
      intent.last_payment_error?.code ?? intent.status,
    );
    if (transitioned) {
      eventBus.emit({
        type: "auto-reload-failed",
        orgId,
        reloadAmount: attempt.amountCents / 100,
        remainingBalance: currentBalance,
        reason: intent.last_payment_error?.code ?? intent.status,
      });
    }
    return "failed";
  }

  // `processing`, `requires_confirmation`, and `requires_capture` are active
  // states. Persist the PI and wait for an authoritative webhook/retrieval;
  // never release the org slot and create a second charge.
  await prisma.autoReloadAttempt.updateMany({
    where: {
      id: attempt.id,
      organizationId: orgId,
      idempotencyKey: attempt.idempotencyKey,
      activeOrganizationId: orgId,
      status: { in: ["submitting", "processing", "uncertain"] },
      OR: [
        { stripePaymentIntentId: null },
        { stripePaymentIntentId: intent.id },
      ],
    },
    data: {
      status: "processing",
      stripePaymentIntentId: intent.id,
      failureReason: null,
      leaseExpiresAt: new Date(Date.now() + AUTO_RELOAD_LEASE_MS),
    },
  });
  return "active";
}

async function reconcilePersistedAutoReloadAttempt(
  orgId: string,
  currentBalance: number,
  attempt: AutoReloadAttemptState,
): Promise<void> {
  const intent = await findPersistedAutoReloadPaymentIntent(attempt);
  if (intent) {
    if (
      intent.status !== "succeeded"
      && intent.status !== "canceled"
      && shouldCancelUnresolvedAutoReloadPaymentIntent(intent, attempt)
    ) {
      // Nonterminal PIs can still succeed later. Cancel them authoritatively
      // before releasing the org slot; a race that already succeeded makes
      // Stripe reject cancellation and the next retrieval grants the credits.
      const canceled = await getStripe().paymentIntents.cancel(intent.id);
      await applyAutoReloadPaymentIntent(orgId, currentBalance, canceled, attempt);
    } else {
      await applyAutoReloadPaymentIntent(orgId, currentBalance, intent, attempt);
    }
    return;
  }

  const now = new Date();
  if (attempt.status === "charged") {
    // `charged` is value-bearing state. A missing PI id/object is corruption,
    // not proof that Stripe did not charge, so never release the org slot or
    // create a replacement charge. The recurring error keeps this visible to
    // operators until the original PI can be recovered.
    await prisma.autoReloadAttempt.updateMany({
      where: {
        id: attempt.id,
        activeOrganizationId: orgId,
        idempotencyKey: attempt.idempotencyKey,
        status: "charged",
      },
      data: {
        failureReason: "charged_payment_intent_missing",
        leaseExpiresAt: new Date(now.getTime() + AUTO_RELOAD_LEASE_MS),
      },
    });
    throw new Error("Charged auto-reload attempt has no recoverable PaymentIntent");
  }

  if (!attempt.lastSubmittedAt) {
    // Only `pending` is proven pre-submission. Any other state without a
    // submission timestamp predates/infringes the durable boundary and cannot
    // safely be retried or released based on database state alone.
    if (attempt.status === "pending") {
      await executeAutoReloadAttempt(orgId, currentBalance, attempt);
      return;
    }
    await prisma.autoReloadAttempt.updateMany({
      where: {
        id: attempt.id,
        activeOrganizationId: orgId,
        idempotencyKey: attempt.idempotencyKey,
        status: { in: ["submitting", "processing", "uncertain"] },
        stripePaymentIntentId: null,
      },
      data: {
        status: "uncertain",
        failureReason: "submission_timestamp_missing",
        leaseExpiresAt: new Date(now.getTime() + AUTO_RELOAD_LEASE_MS),
      },
    });
    throw new Error("Uncertain auto-reload attempt has no submission timestamp");
  }

  if (attempt.retryUntil > now) {
    // Retry the exact persisted request/key directly from its in-flight state.
    // Never transiently label a previously submitted request `pending`, because
    // settings changes are allowed to cancel only never-submitted rows.
    await executeAutoReloadAttempt(orgId, currentBalance, attempt);
    return;
  }

  const settleUntil = new Date(Math.max(
    attempt.lastSubmittedAt.getTime() + AUTO_RELOAD_SUBMISSION_SETTLE_MS,
    attempt.retryUntil.getTime() + AUTO_RELOAD_SUBMISSION_SETTLE_MS,
  ));
  if (settleUntil > now) {
    await prisma.autoReloadAttempt.updateMany({
      where: {
        id: attempt.id,
        activeOrganizationId: orgId,
        idempotencyKey: attempt.idempotencyKey,
        status: { in: ["submitting", "processing", "uncertain"] },
        stripePaymentIntentId: null,
      },
      data: {
        status: "uncertain",
        failureReason: "awaiting_stripe_settlement",
        leaseExpiresAt: new Date(now.getTime() + AUTO_RELOAD_LEASE_MS),
      },
    });
    return;
  }

  // The retry window has closed and every submission has had a conservative
  // settlement interval. Only the fresh, customer-scoped Stripe list above,
  // with exact local validation and no match, now permits a replacement claim.
  const released = await prisma.autoReloadAttempt.updateMany({
    where: {
      id: attempt.id,
      activeOrganizationId: orgId,
      idempotencyKey: attempt.idempotencyKey,
      status: { in: ["submitting", "processing", "uncertain"] },
      stripePaymentIntentId: null,
    },
    data: {
      status: "failed",
      activeOrganizationId: null,
      failureReason: "payment_intent_not_found",
      completedAt: now,
    },
  });
  if (released.count === 1) {
    // The prior logical request is now proven absent; create a fresh durable
    // attempt if the owner still has auto-reload enabled and remains below the
    // threshold. This prevents a permanent `uncertain` dead-end.
    await triggerAutoReloadIfNeeded(orgId, currentBalance);
  }
}

async function processDurableAutoReloadAttempt(
  orgId: string,
  currentBalance: number,
  attempt: AutoReloadAttemptState,
): Promise<void> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + AUTO_RELOAD_LEASE_MS);

  if (attempt.status === "charged") {
    const claimed = await prisma.autoReloadAttempt.updateMany({
      where: {
        id: attempt.id,
        activeOrganizationId: orgId,
        status: "charged",
        leaseExpiresAt: { lte: now },
      },
      data: { leaseExpiresAt },
    });
    if (claimed.count !== 1) return;
    if (!attempt.stripePaymentIntentId) {
      await reconcilePersistedAutoReloadAttempt(orgId, currentBalance, {
        ...attempt,
        leaseExpiresAt,
      });
      return;
    }
    let latestCharge: string | null = null;
    try {
      const intent = await getStripe().paymentIntents.retrieve(attempt.stripePaymentIntentId);
      latestCharge = stripeObjectId(intent.latest_charge);
    } catch {
      /* non-critical — receipt backfill only */
    }
    await grantAutoReloadFromPaymentIntent(
      orgId,
      attempt.amountCents / 100,
      attempt.stripePaymentIntentId,
      latestCharge,
      { id: attempt.id, idempotencyKey: attempt.idempotencyKey },
    );
    return;
  }

  if (attempt.status === "initializing") {
    const claimed = await prisma.autoReloadAttempt.updateMany({
      where: {
        id: attempt.id,
        activeOrganizationId: orgId,
        status: "initializing",
        leaseExpiresAt: { lte: now },
      },
      data: { leaseExpiresAt },
    });
    if (claimed.count !== 1) return;

    const config = await prisma.autoReloadConfig.findUnique({
      where: { organizationId: orgId },
      select: { enabled: true },
    });
    if (!config?.enabled) {
      await prisma.autoReloadAttempt.updateMany({
        where: {
          id: attempt.id,
          activeOrganizationId: orgId,
          status: "initializing",
          stripePaymentIntentId: null,
        },
        data: {
          status: "disabled",
          activeOrganizationId: null,
          failureReason: "auto_reload_disabled",
          completedAt: now,
        },
      });
      return;
    }

    const paymentMethod = await getOffSessionPaymentMethodId(attempt.stripeCustomerId);
    if (!paymentMethod) {
      const failed = await prisma.autoReloadAttempt.updateMany({
        where: {
          id: attempt.id,
          activeOrganizationId: orgId,
          status: "initializing",
        },
        data: {
          status: "failed",
          failureReason: "no_payment_method",
          leaseExpiresAt,
          completedAt: now,
        },
      });
      if (failed.count === 1) {
        eventBus.emit({
          type: "auto-reload-failed",
          orgId,
          reloadAmount: attempt.amountCents / 100,
          remainingBalance: currentBalance,
          reason: "no_payment_method",
        });
      }
      return;
    }

    const initialized = await prisma.autoReloadAttempt.updateMany({
      where: {
        id: attempt.id,
        activeOrganizationId: orgId,
        status: "initializing",
      },
      data: {
        status: "pending",
        stripePaymentMethodId: paymentMethod,
      },
    });
    if (initialized.count !== 1) return;
    await executeAutoReloadAttempt(orgId, currentBalance, {
      ...attempt,
      status: "pending",
      stripePaymentMethodId: paymentMethod,
      leaseExpiresAt,
    });
    return;
  }

  if (attempt.status === "pending") {
    const claimed = await prisma.autoReloadAttempt.updateMany({
      where: {
        id: attempt.id,
        activeOrganizationId: orgId,
        status: "pending",
        leaseExpiresAt: { lte: now },
      },
      data: { leaseExpiresAt },
    });
    if (claimed.count !== 1) return;
    const claimedAttempt = { ...attempt, leaseExpiresAt };
    if (attempt.stripePaymentIntentId) {
      await reconcilePersistedAutoReloadAttempt(orgId, currentBalance, claimedAttempt);
    } else {
      await executeAutoReloadAttempt(orgId, currentBalance, claimedAttempt);
    }
    return;
  }

  if (
    attempt.status === "submitting"
    || attempt.status === "processing"
    || attempt.status === "uncertain"
  ) {
    const claimed = await prisma.autoReloadAttempt.updateMany({
      where: {
        id: attempt.id,
        activeOrganizationId: orgId,
        status: attempt.status,
        leaseExpiresAt: { lte: now },
      },
      data: { leaseExpiresAt },
    });
    if (claimed.count === 1) {
      await reconcilePersistedAutoReloadAttempt(orgId, currentBalance, {
        ...attempt,
        leaseExpiresAt,
      });
    }
  }
}

export async function triggerAutoReloadIfNeeded(
  orgId: string,
  currentBalance: number,
): Promise<void> {
  const claim = await prisma.$transaction(async (tx) => {
    await lockAutoReloadOrganization(tx, orgId);
    return ensureDurableAutoReloadAttempt(orgId, currentBalance, tx);
  });
  if (!claim?.readyToProcess) return;
  await processDurableAutoReloadAttempt(orgId, currentBalance, claim.attempt);
}

/** Recover every expired active state; each row is protected by a DB lease. */
export async function reconcileAutoReloadAttempts(): Promise<{
  scanned: number;
  attempted: number;
  failed: number;
}> {
  const now = new Date();
  const candidates = await prisma.autoReloadAttempt.findMany({
    where: {
      activeOrganizationId: { not: null },
      status: { in: ["initializing", "pending", "submitting", "processing", "charged", "uncertain"] },
      leaseExpiresAt: { lte: now },
    },
    select: { id: true, organizationId: true },
    orderBy: { leaseExpiresAt: "asc" },
    take: AUTO_RELOAD_RECONCILE_BATCH_SIZE,
  });

  let attempted = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      const balance = await getOrgBalance(candidate.organizationId);
      await triggerAutoReloadIfNeeded(candidate.organizationId, balance.total);
      attempted += 1;
    } catch (err) {
      failed += 1;
      console.error("[credits] Auto-reload reconciliation failed:", {
        attemptId: candidate.id,
        organizationId: candidate.organizationId,
        err,
      });
    }
  }

  return { scanned: candidates.length, attempted, failed };
}

function isIndeterminateStripeError(err: unknown): boolean {
  const stripeError = err as { type?: unknown; rawType?: unknown; code?: unknown } | null;
  const type = typeof stripeError?.type === "string"
    ? stripeError.type
    : typeof stripeError?.rawType === "string"
      ? stripeError.rawType
      : undefined;
  if (
    type === "StripeIdempotencyError"
    || type === "idempotency_error"
    || stripeError?.code === "idempotency_key_in_use"
  ) {
    return true;
  }

  // Idempotency conflicts are deliberately indeterminate: another same-key
  // request may still be executing, so the attempt remains active for Stripe
  // reconciliation instead of becoming a retryable failure.
  return !new Set([
    "StripeCardError",
    "card_error",
    "StripeInvalidRequestError",
    "invalid_request_error",
    "StripeAuthenticationError",
    "authentication_error",
    "StripePermissionError",
  ]).has(type ?? "");
}

async function executeAutoReloadAttempt(
  orgId: string,
  currentBalance: number,
  attempt: AutoReloadAttemptState,
): Promise<void> {
  if (!attempt.stripePaymentMethodId) {
    throw new Error("Cannot execute an auto-reload before its card is persisted");
  }
  if (!["pending", "submitting", "processing", "uncertain"].includes(attempt.status)) {
    throw new Error(`Cannot submit an auto-reload from state ${attempt.status}`);
  }

  const submittedAt = new Date();
  const retryUntil = attempt.lastSubmittedAt
    ? attempt.retryUntil
    : new Date(submittedAt.getTime() + AUTO_RELOAD_RETRY_WINDOW_MS);
  // This CAS is the exact pre-I/O boundary. Disabling/replacing a card may
  // cancel a `pending` row; if that transaction wins, no Stripe request runs.
  // If this CAS wins first, the request is durably marked in-flight and later
  // settings changes preserve it for reconciliation.
  const submitted = await prisma.autoReloadAttempt.updateMany({
    where: {
      id: attempt.id,
      activeOrganizationId: orgId,
      idempotencyKey: attempt.idempotencyKey,
      status: attempt.status,
      stripePaymentIntentId: null,
    },
    data: {
      status: "submitting",
      lastSubmittedAt: submittedAt,
      retryUntil,
      failureReason: null,
      leaseExpiresAt: new Date(submittedAt.getTime() + AUTO_RELOAD_LEASE_MS),
    },
  });
  if (submitted.count !== 1) return;

  const submittedAttempt: AutoReloadAttemptState = {
    ...attempt,
    status: "submitting",
    lastSubmittedAt: submittedAt,
    retryUntil,
    failureReason: null,
    leaseExpiresAt: new Date(submittedAt.getTime() + AUTO_RELOAD_LEASE_MS),
  };
  const reloadAmount = attempt.amountCents / 100;
  let paymentIntent: Stripe.PaymentIntent;
  try {
    paymentIntent = await getStripe().paymentIntents.create(
      {
        amount: attempt.amountCents,
        currency: "usd",
        customer: attempt.stripeCustomerId,
        payment_method: attempt.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        metadata: {
          orgId,
          type: "auto_reload",
          amountUsd: String(reloadAmount),
          autoReloadAttemptId: attempt.id,
          autoReloadKey: attempt.idempotencyKey,
        },
      },
      { idempotencyKey: attempt.idempotencyKey },
    );
  } catch (err) {
    console.error("[credits] Auto-reload payment request failed:", err);
    const code = (err as { code?: unknown } | null)?.code;
    const reason = typeof code === "string" ? code : undefined;
    const indeterminate = isIndeterminateStripeError(err);
    const transitioned = await prisma.autoReloadAttempt.updateMany({
      where: {
        id: attempt.id,
        activeOrganizationId: orgId,
        idempotencyKey: attempt.idempotencyKey,
        status: "submitting",
      },
      data: indeterminate
        ? {
            status: "uncertain",
            leaseExpiresAt: new Date(Date.now() + AUTO_RELOAD_LEASE_MS),
            failureReason: "payment_status_unknown",
          }
        : {
            status: "failed",
            failureReason: reason ?? "payment_failed",
            leaseExpiresAt: new Date(Date.now() + AUTO_RELOAD_LEASE_MS),
            completedAt: new Date(),
          },
    });

    if (!indeterminate && transitioned.count === 1) {
      eventBus.emit({
        type: "auto-reload-failed",
        orgId,
        reloadAmount,
        remainingBalance: currentBalance,
        reason,
      });
    }
    return;
  }

  await applyAutoReloadPaymentIntent(orgId, currentBalance, paymentIntent, submittedAttempt);
}

export async function hasEnoughCredits(
  orgId: string,
  estimatedCost: number,
): Promise<boolean> {
  const { total } = await getOrgBalance(orgId);
  return total >= estimatedCost;
}
