import "server-only";
import { randomUUID } from "node:crypto";
import { prisma, type MarketingConversion, type Prisma } from "@octopus/db";
import { conversionId, type MarketingConfig } from "./marketing-conversions";
import { normalizeMarketingCash } from "./marketing-cash-contract";
import { readMarketingLedger, type MarketingLedgerFact } from "./marketing-ledger";
import { cashAssert, cashBinding, cashDigest, cashTime, compareCashBatch, type CashBinding, type CashMember } from "./marketing-cash-compare";

const LIMIT = 1000;
const MAX_DOCUMENT = 4 * 1024 * 1024;
type Scope = { from: string; to: string };
type Stored = { id: string; sourceId: string; environment: string; kind: string; parentId: string | null; digest: string; body: string };
type Normalized = ReturnType<typeof normalizeMarketingCash>;
type Member = CashMember & { businessIdentity: string; dependency: boolean; occurredAt: string; aliases: string[] };
export type CashInventory = ReturnType<typeof assembleCashInventory>;

/** Pure inventory accounting; callers must supply one consistent retained snapshot. */
export function assembleCashInventory(config: MarketingConfig, binding: CashBinding, scope: Scope, ledger: MarketingLedgerFact[], rows: MarketingConversion[], truncated: boolean) {
  cashAssert(cashTime(scope.from) < cashTime(scope.to));
  const gaps: { code: string; origin: string }[] = [];
  const gap = (code: string, origin: string) => gaps.push({ code, origin });
  if (truncated) gap("truncated", "snapshot");
  const eligible = new Map(ledger.map(l => [`ledger:${l.id}`, l]));
  for (const [origin] of eligible) if (!rows.some(r => r.originKey === origin)) gap("missing_outbox", origin);
  const groups = new Map<string, { event: Normalized; rows: MarketingConversion[]; conflict: boolean }>();
  for (const row of rows) {
    if (row.sourceId !== config.sourceId || row.environment !== config.environment) { gap("scope_conflict", row.id); continue; }
    if ((row.kind === "purchase" && !/^(pi_|cs_)/.test(row.reference)) || (row.kind === "refund" && !/^(re_|pyr_)/.test(row.reference))) { gap("unsupported_reference", row.id); continue; }
    const fact = eligible.get(row.originKey);
    if (fact && (row.reference !== (fact.stripeRefundId ?? fact.stripeSessionId) || row.organizationId !== fact.organizationId || row.sourceCreatedAt.getTime() !== fact.createdAt.getTime())) gap("ledger_origin_conflict", row.id);
    if (!row.payload) { gap("unresolved_payload", row.id); continue; }
    try {
      const event = normalizeMarketingCash(row.payload);
      if (event.eventType !== row.kind || !row.organizationId || event.customerId !== conversionId("organization", row.organizationId)) { gap("payload_scope_conflict", row.id); continue; }
      if (row.kind === "refund" && event.transactionId !== conversionId("refund", row.reference)) { gap("refund_identity_conflict", row.id); continue; }
      if (row.kind === "purchase" && row.reference.startsWith("pi_") && event.transactionId !== conversionId("payment", row.reference)) { gap("payment_identity_conflict", row.id); continue; }
      if (row.originKey.startsWith("payment:") && (row.originKey !== `payment:${row.reference}` || !row.reference.startsWith("pi_"))) { gap("dependency_origin_conflict", row.id); continue; }
      const existing = groups.get(event.businessIdentity);
      if (existing) { existing.rows.push(row); if (existing.event.semanticDigest !== event.semanticDigest) { existing.conflict = true; gap("alias_content_conflict", row.id); } }
      else groups.set(event.businessIdentity, { event, rows: [row], conflict: false });
    } catch { gap("invalid_payload", row.id); }
  }
  const selected = new Set<string>();
  for (const [key, g] of groups) if (g.rows.some(r => eligible.has(r.originKey)) && g.event.occurredAt >= scope.from && g.event.occurredAt < scope.to) selected.add(key);
  const primary = new Set(selected);
  for (const key of primary) {
    const g = groups.get(key)!;
    if (g.event.eventType !== "refund") continue;
    const originalKey = JSON.stringify(["purchase", g.event.originalTransactionId]); const original = groups.get(originalKey);
    if (!original || original.conflict || original.event.customerId !== g.event.customerId || original.event.currency !== g.event.currency || original.event.occurredAt > g.event.occurredAt || BigInt(original.event.amountMinor) < BigInt(g.event.amountMinor)) gap("unresolved_original", key);
    else selected.add(originalKey);
  }
  const members: Member[] = [];
  for (const key of [...selected].sort()) {
    const g = groups.get(key)!;
    const delivered = g.rows.filter(r => r.status === "delivered"); const receipts = new Set(delivered.map(r => r.receiptId));
    const invalid = delivered.some(r => !r.receiptId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(r.receiptId) || !r.deliveredAt || ![200, 201].includes(r.httpStatus ?? 0));
    if (invalid || receipts.size > 1) { gap("alias_receipt_conflict", key); g.conflict = true; }
    if (g.rows.some(r => r.status !== "delivered")) gap("delivery_incomplete", key);
    if (g.conflict) continue;
    members.push({ businessIdentity: key, eventType: g.event.eventType, transactionId: g.event.transactionId, semanticDigest: g.event.semanticDigest, receiptId: delivered[0]?.receiptId ?? null, dependency: !primary.has(key), occurredAt: g.event.occurredAt, aliases: g.rows.map(r => r.id).sort() });
  }
  // Captured origins outside the retained eligible ledger cannot silently establish capture coverage.
  for (const row of rows) if (row.originKey.startsWith("ledger:") && row.sourceCreatedAt >= config.from && !eligible.has(row.originKey)) gap("unaccounted_retained_origin", row.id);
  return { schemaVersion: 1, captureContract: "retained-cash/v1", normalizationContract: "unified-ads/conversion-event-semantic/v1", binding, activationFrom: config.from.toISOString(), scope, upstreamCompleteness: "unknown" as const,
    A: "not_observed" as const, B: gaps.length ? "incomplete" : "complete_retained_scope", C: "unknown" as const,
    limitations: ["retained eligible ledger only", "no upstream inventory", "no first-knowledge or commit high-water", "no customer-zero or learning admission"],
    members, gaps, ledger: ledger.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })),
    outbox: rows.map(r => ({ id: r.id, originKey: r.originKey, kind: r.kind, reference: r.reference, organizationId: r.organizationId, environment: r.environment, sourceCreatedAt: r.sourceCreatedAt.toISOString(), createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), payload: r.payload, status: r.status, attempts: r.attempts, nextAttemptAt: r.nextAttemptAt.toISOString(), leaseUntil: r.leaseUntil?.toISOString() ?? null, receiptId: r.receiptId, httpStatus: r.httpStatus, errorCode: r.errorCode, deliveredAt: r.deliveredAt?.toISOString() ?? null })) };
}
async function readStored(db: Pick<Prisma.TransactionClient, "$queryRaw">, id: string, config: MarketingConfig) {
  cashAssert(/^[0-9a-f-]{36}$/.test(id));
  const rows = await db.$queryRaw<Stored[]>`SELECT * FROM marketing_cash_observations WHERE id=${id} AND "sourceId"=${config.sourceId} AND environment=${config.environment}`;
  const row = rows[0]; cashAssert(row && cashDigest(row.body) === row.digest); return row;
}
export async function append(db: Pick<Prisma.TransactionClient, "$executeRaw">, config: MarketingConfig, kind: string, parentId: string | null, document: unknown) {
  const id = randomUUID(); const body = JSON.stringify({ id, ...document as object }); cashAssert(Buffer.byteLength(body) <= MAX_DOCUMENT); const digest = cashDigest(body);
  await db.$executeRaw`INSERT INTO marketing_cash_observations (id,"sourceId",environment,kind,"parentId",digest,body) VALUES (${id},${config.sourceId},${config.environment},${kind},${parentId},${digest},${body})`;
  return { id, digest, document: JSON.parse(body) };
}
export async function createCashInventory(config: MarketingConfig, binding: CashBinding, scope: Scope, predecessor: string | null = null) {
  cashBinding(config, JSON.stringify(binding)); cashAssert(cashTime(scope.from) < cashTime(scope.to) && Date.parse(scope.to) <= Date.now());
  return prisma.$transaction(async tx => {
    const startedAt = new Date().toISOString();
    const prior = predecessor ? await readStored(tx, predecessor, config) : null;
    if (prior) { const p = JSON.parse(prior.body); cashAssert(prior.kind === "inventory" && JSON.stringify(p.binding) === JSON.stringify(binding) && JSON.stringify(p.scope) === JSON.stringify(scope) && p.activationFrom === config.from.toISOString()); }
    const ledger = await readMarketingLedger(tx, config.from, LIMIT + 1);
    const rows = await tx.marketingConversion.findMany({ where: { sourceId: config.sourceId, kind: { in: ["purchase", "refund"] }, sourceCreatedAt: { gte: config.from } }, orderBy: { id: "asc" }, take: LIMIT + 1 });
    const originals = new Set<string>();
    for (const row of rows) { try { if (row.payload) { const e = normalizeMarketingCash(row.payload); if (e.originalTransactionId && e.occurredAt >= scope.from && e.occurredAt < scope.to && ledger.some(l => row.originKey === `ledger:${l.id}`)) originals.add(e.originalTransactionId); } } catch { /* captured as an unresolved gap */ } }
    const dependencies = originals.size ? await tx.marketingConversion.findMany({ where: { sourceId: config.sourceId, kind: "purchase", sourceCreatedAt: { lt: config.from }, OR: [...originals].map(id => ({ payload: { contains: id } })) }, orderBy: { id: "asc" }, take: LIMIT + 1 }) : [];
    const inventory = assembleCashInventory(config, binding, scope, ledger.slice(0, LIMIT), [...rows.slice(0, LIMIT), ...dependencies.slice(0, LIMIT)], ledger.length > LIMIT || rows.length > LIMIT || dependencies.length > LIMIT);
    return append(tx, config, "inventory", predecessor, { ...inventory, producerObservation: { startedAt, completedAt: new Date().toISOString() }, predecessorDigest: prior?.digest ?? null });
  }, { isolationLevel: "RepeatableRead", timeout: 15000 });
}
export async function getCashObservation(config: MarketingConfig, id: string) {
  const row = await readStored(prisma, id, config); return { id: row.id, digest: row.digest, document: JSON.parse(row.body) };
}
export async function compareCashInventory(config: MarketingConfig, binding: CashBinding, id: string, send: typeof fetch = fetch) {
  cashBinding(config, JSON.stringify(binding)); const row = await readStored(prisma, id, config); cashAssert(row.kind === "inventory");
  const inventory = JSON.parse(row.body) as CashInventory; cashAssert(JSON.stringify(inventory.binding) === JSON.stringify(binding) && inventory.activationFrom === config.from.toISOString());
  const batches: Awaited<ReturnType<typeof compareCashBatch>>[] = []; let failure: string | null = null;
  for (let i = 0; i < inventory.members.length; i += 32) {
    const entries = inventory.members.slice(i, i + 32).map(({ eventType, transactionId, semanticDigest, receiptId }) => ({ eventType, transactionId, semanticDigest, receiptId }));
    try { batches.push(await compareCashBatch(config, binding, entries, send)); } catch { failure = "comparison_unavailable_or_invalid"; break; }
  }
  const matched = batches.reduce((n, b) => n + (b.response.entries as { status: string }[]).filter(r => r.status === "matched").length, 0);
  return append(prisma, config, "comparison", id, { inventoryDigest: row.digest, binding, batches, failure,
    A: !inventory.members.length ? "no_declared_members" : !failure && matched === inventory.members.length ? "declared_members_matched" : "incomplete",
    B: inventory.B, C: "unknown", lostAcknowledgment: "evidence_only_outbox_unchanged", completedAt: new Date().toISOString() });
}
