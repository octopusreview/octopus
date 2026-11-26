import "server-only";
import { readMarketingLedger } from "./marketing-ledger";
import { randomUUID } from "node:crypto";
import { prisma, type MarketingConversion, type Prisma } from "@octopus/db";
import { deliverTracking, parseTrackingPayload, resolveTrackingConfig, type TrackingConfig } from "./marketing-tracking";
import { getStripe } from "./stripe";
import {
  deliverConversion,
  registrationEvent,
  registrationVoidEvent,
  resolveMarketingConfig,
  retryDelayMs,
  serializeConversion,
  type DeliveryResult,
  type MarketingConfig,
} from "./marketing-conversions";
import { MarketingSourceError, marketingStripeReader, resolveStripeConversion, type MarketingStripeReader } from "./marketing-stripe";

const CAPTURE_BATCH = 100;
const LEASE_MS = 120_000;
const TICK_MS = 90_000;
const DELIVERY_BATCH = 20;
const MAX_PURCHASE_ALIASES = 100;

/** Internal server interface only. Capture must verify consent and campaign membership first. */
export async function enqueueMarketingTracking(config: TrackingConfig, payload: string): Promise<string> {
  const record = parseTrackingPayload(payload, config);
  const originKey = `tracking:${config.trackingId}:${record.eventId}`;
  const row = await prisma.marketingConversion.upsert({
    where: { sourceId_originKey: { sourceId: config.sourceId, originKey } },
    create: {
      sourceId: config.sourceId, environment: config.environment, originKey,
      kind: record.recordType, reference: config.trackingId,
      sourceCreatedAt: new Date(record.occurredAt), payload,
    },
    update: {},
  });
  if (row.payload !== payload || row.environment !== config.environment || row.reference !== config.trackingId) {
    throw new MarketingSourceError("tracking_identity_conflict");
  }
  return row.id;
}

/** Reconcile committed facts, not hook callbacks or an unsafe commit-time cursor. */
export async function captureMarketingConversions(config: MarketingConfig): Promise<number> {
  const mismatched = await prisma.marketingConversion.findFirst({ where: { sourceId: config.sourceId, environment: { not: config.environment } }, select: { id: true } });
  if (mismatched) throw new MarketingSourceError("source_environment_mismatch");
  const [users, banned, financial] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; createdAt: Date }>>`
      SELECT u.id, u."createdAt" FROM users u
      WHERE u."createdAt" >= ${config.from}
        AND NOT EXISTS (SELECT 1 FROM marketing_conversions o
          WHERE o."sourceId" = ${config.sourceId} AND o."originKey" = 'registration:' || u.id)
      ORDER BY u."createdAt", u.id LIMIT ${CAPTURE_BATCH}`,
    // Bans are set outside the application, so they are found here, not in a hook.
    // shortcut: one void per account and an un-ban is not reported; add a "valid"
    // event (and the ban time in the origin key) once accounts get un-banned.
    prisma.$queryRaw<Array<{ id: string; bannedAt: Date }>>`
      SELECT u.id, u."bannedAt" FROM users u
      WHERE u."bannedAt" IS NOT NULL
        AND EXISTS (SELECT 1 FROM marketing_conversions o
          WHERE o."sourceId" = ${config.sourceId} AND o."originKey" = 'registration:' || u.id)
        AND NOT EXISTS (SELECT 1 FROM marketing_conversions o
          WHERE o."sourceId" = ${config.sourceId} AND o."originKey" = 'registration_void:' || u.id)
      ORDER BY u."bannedAt", u.id LIMIT ${CAPTURE_BATCH}`,
    readMarketingLedger(prisma, config.from, CAPTURE_BATCH, config.sourceId),
  ]);
  const rows = [
    ...users.map(user => ({ sourceId: config.sourceId, environment: config.environment, originKey: `registration:${user.id}`, kind: "registration", reference: user.id, sourceCreatedAt: user.createdAt, organizationId: null, payload: serializeConversion(registrationEvent(user.id, user.createdAt)) })),
    ...banned.map(user => ({ sourceId: config.sourceId, environment: config.environment, originKey: `registration_void:${user.id}`, kind: "registration_status", reference: user.id, sourceCreatedAt: user.bannedAt, organizationId: null, payload: serializeConversion(registrationVoidEvent(user.id, user.bannedAt)) })),
    ...financial.map(row => ({ sourceId: config.sourceId, environment: config.environment, originKey: `ledger:${row.id}`, kind: row.stripeRefundId ? "refund" : "purchase", reference: (row.stripeRefundId ?? row.stripeSessionId)!, organizationId: row.organizationId, sourceCreatedAt: row.createdAt, payload: null })),
  ];
  if (!rows.length) return 0;
  return (await prisma.marketingConversion.createMany({ data: rows, skipDuplicates: true })).count;
}

export async function claimMarketingConversion(config: MarketingConfig, now = new Date(), trackingEnabled = false): Promise<MarketingConversion | null> {
  const leaseId = randomUUID();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const rows = await prisma.$queryRaw<MarketingConversion[]>`
    WITH candidate AS (
      SELECT id FROM marketing_conversions
      WHERE "sourceId" = ${config.sourceId} AND environment = ${config.environment}
        AND (${trackingEnabled} OR kind NOT IN ('visit', 'conversion_context'))
        AND ((status = 'pending' AND "nextAttemptAt" <= ${now}) OR (status = 'processing' AND "leaseUntil" <= ${now}))
      ORDER BY (kind IN ('visit', 'conversion_context')), "nextAttemptAt", id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE marketing_conversions o
    SET status = 'processing', "leaseId" = ${leaseId}, "leaseUntil" = ${leaseUntil},
        attempts = attempts + 1, "updatedAt" = ${now}
    FROM candidate WHERE o.id = candidate.id RETURNING o.*`;
  return rows[0] ?? null;
}

/** Fences a late result from a worker whose lease expired or was reclaimed. */
export async function finishMarketingConversion(row: MarketingConversion, result: DeliveryResult, now = new Date()): Promise<boolean> {
  const data = result.kind === "delivered"
    ? { status: "delivered", receiptId: result.receiptId, httpStatus: result.status, deliveredAt: now, errorCode: null }
    : { status: result.kind === "blocked" ? "blocked" : "pending", httpStatus: result.status ?? null, errorCode: result.code, nextAttemptAt: new Date(now.getTime() + retryDelayMs(row.attempts, result.retryAfterMs)) };
  const updated = await prisma.marketingConversion.updateMany({
    where: { id: row.id, status: "processing", leaseId: row.leaseId, leaseUntil: { gt: now } },
    data: { ...data, leaseId: null, leaseUntil: null },
  });
  return updated.count === 1;
}

/** Reuse the already delivered canonical purchase, irrespective of its ledger/PI origin. */
export async function deliveredMarketingPurchase(
  db: Pick<Prisma.TransactionClient, "marketingConversion">,
  row: MarketingConversion,
  original: NonNullable<Awaited<ReturnType<typeof resolveStripeConversion>>["originalPurchase"]>,
): Promise<MarketingConversion | null> {
  const matches = await db.marketingConversion.findMany({
    where: { sourceId: row.sourceId, kind: "purchase", status: "delivered", payload: { contains: original.event.transactionId } },
    orderBy: { id: "asc" },
    take: MAX_PURCHASE_ALIASES + 1,
  });
  if (!matches.length) return null;
  const purchase = matches[0]!;
  const payload = serializeConversion(original.event);
  if (matches.length > MAX_PURCHASE_ALIASES || matches.some(candidate =>
    candidate.environment !== row.environment || candidate.organizationId !== row.organizationId ||
    candidate.payload !== payload || !candidate.receiptId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate.receiptId) ||
    candidate.receiptId !== purchase.receiptId || !candidate.deliveredAt ||
    (candidate.httpStatus !== 200 && candidate.httpStatus !== 201))) {
    throw new MarketingSourceError("original_payment_conflict");
  }
  return purchase;
}

async function persistedBody(row: MarketingConversion, config: MarketingConfig, reader?: MarketingStripeReader): Promise<string | null> {
  if (row.payload !== null) return row.payload;
  let body: string;
  let original: Awaited<ReturnType<typeof resolveStripeConversion>>["originalPurchase"];
  if (row.kind === "registration") {
    body = serializeConversion(registrationEvent(row.reference, row.sourceCreatedAt));
  } else {
    if ((row.kind !== "purchase" && row.kind !== "refund") || !row.organizationId) throw new MarketingSourceError("invalid_outbox_source");
    const resolved = await resolveStripeConversion(reader ?? marketingStripeReader(getStripe()), row.kind, row.reference, row.organizationId, config.environment);
    body = serializeConversion(resolved.event);
    original = resolved.originalPurchase;
  }
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const updated = await tx.marketingConversion.updateMany({
      where: { id: row.id, status: "processing", leaseId: row.leaseId, leaseUntil: { gt: now }, payload: null },
      data: { payload: body },
    });
    if (updated.count !== 1) return null;
    if (original && !await deliveredMarketingPurchase(tx, row, original)) {
      // A refund may be inside the collection window while its payment is
      // outside it. Preserve the real original, never invent a zero purchase.
      const originalBody = serializeConversion(original.event);
      const originKey = `payment:${original.paymentIntentId}`;
      const dependency = await tx.marketingConversion.upsert({
        where: { sourceId_originKey: { sourceId: config.sourceId, originKey } },
        create: { sourceId: config.sourceId, environment: config.environment, originKey, kind: "purchase", reference: original.paymentIntentId, organizationId: row.organizationId, sourceCreatedAt: new Date(original.event.occurredAt), payload: originalBody },
        update: {},
      });
      if (dependency.payload !== originalBody || dependency.environment !== config.environment) throw new MarketingSourceError("original_payment_conflict");
    }
    return body;
  });
}

export async function processMarketingConversion(
  row: MarketingConversion,
  config: MarketingConfig,
  reader?: MarketingStripeReader,
  send?: (request: Request) => Promise<Response>,
  tracking?: TrackingConfig | null,
): Promise<"delivered" | "retry" | "blocked" | "lease_lost"> {
  if (row.sourceId !== config.sourceId || row.environment !== config.environment) throw new MarketingSourceError("outbox_source_mismatch");
  let result: DeliveryResult;
  try {
    const body = await persistedBody(row, config, reader);
    if (body === null) return "lease_lost";
    const owned = await prisma.marketingConversion.count({ where: { id: row.id, leaseId: row.leaseId, status: "processing", leaseUntil: { gt: new Date() } } });
    if (!owned) return "lease_lost";
    if (row.kind === "visit" || row.kind === "conversion_context") {
      if (!tracking) throw new MarketingSourceError("tracking_disabled", true);
      if (tracking.sourceId !== config.sourceId || tracking.environment !== config.environment ||
          tracking.serverKey !== config.serverKey || tracking.trackingId !== row.reference) {
        throw new MarketingSourceError("tracking_binding_mismatch");
      }
      result = await deliverTracking(tracking, body, send);
    } else result = await deliverConversion(config, body, send);
  } catch (error) {
    if (error instanceof MarketingSourceError) {
      result = { kind: error.retryable ? "retry" : "blocked", code: error.code };
    } else {
      const missing = typeof error === "object" && error !== null && "code" in error && error.code === "resource_missing";
      result = { kind: missing ? "blocked" : "retry", code: missing ? "stripe_reference_missing" : "source_unavailable" };
    }
  }
  if (!await finishMarketingConversion(row, result)) return "lease_lost";
  return result.kind;
}

export async function syncMarketingConversions(): Promise<void> {
  const config = resolveMarketingConfig(process.env);
  if (!config) return;
  if (config.environment !== "live" && process.env.NODE_ENV === "production") throw new MarketingSourceError("production_requires_live_source");
  // Invalid/disabled tracking must not interrupt existing business-event delivery.
  let tracking: TrackingConfig | null = null;
  try { tracking = resolveTrackingConfig(process.env); } catch { /* Tracking rows stay pending. */ }
  const captured = await captureMarketingConversions(config);
  const deadline = Date.now() + TICK_MS;
  const counts = { delivered: 0, retry: 0, blocked: 0, lease_lost: 0 };
  for (let processed = 0; processed < DELIVERY_BATCH && Date.now() < deadline; processed++) {
    const row = await claimMarketingConversion(config, new Date(), tracking !== null);
    if (!row) break;
    counts[await processMarketingConversion(row, config, undefined, undefined, tracking)]++;
  }
  // Counts only: no source references, Stripe objects, bearer keys or bodies.
  console.log("[marketing-conversions]", { captured, ...counts });
}
