import "server-only";
import { prisma, type MarketingConversion } from "@octopus/db";
import { MARKETING_RECEIVER, resolveMarketingConfig, type MarketingConfig } from "./marketing-conversions";
import { normalizeMarketingCash } from "./marketing-cash-contract";
import { readMarketingLedger } from "./marketing-ledger";
import { cashAssert, cashBinding, cashDigest, cashObject, cashTime, type CashBinding } from "./marketing-cash-compare";
import { append } from "./marketing-cash-observation";
import { isSelfHosted } from "./self-hosted";

/** Receiver limits for one complete-period declaration (receipt comparison version 2). */
export const RECONCILIATION_MAX_ENTRIES = 1000;
const MAX_DAYS = 92, MAX_BODY = 264_124, MAX_REPLY = 16_384, TIMEOUT_MS = 15_000, LISTED = 25, DAY_MS = 86_400_000;
/** The scheduled window ends this long before the run, so a sale still being delivered cannot make it stale at once. */
const SETTLE_MS = 2 * 3_600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RECEIVER_CODES = ["INVALID_HOST", "INVALID_RECEIPT_COMPARISON", "INVALID_RECEIPT_RECONCILIATION", "RECEIPT_SET_TOO_LARGE", "INVALID_SOURCE_KEY",
  "SERVER_INTEGRATION_ONLY", "METHOD_NOT_ALLOWED", "BODY_TOO_LARGE", "INVALID_CONTENT_TYPE", "CONVERSION_BUSY", "UPSTREAM_UNAVAILABLE"];
const RECEIVER_FIELDS = ["body", "schemaVersion", "period", "complete", "entries", "eventType", "transactionId", "amountMinor", "currency", "occurredAt", "capability"];
const LIMITATIONS = ["retained billing ledger only, no processor check", "a payment that never reached the ledger is not seen",
  "a ledger row deleted before capture is not seen", "blocked currencies and manual capture are never delivered", "nothing before activation"];

export type CashPeriod = { from: string; to: string };
export type ReconciliationEntry = { eventType: "purchase" | "refund"; transactionId: string; amountMinor: string; currency: string; occurredAt: string };
type DeliveredRow = Pick<MarketingConversion, "kind" | "environment" | "payload" | "receiptId">;
type Reply = ReturnType<typeof validateReconciliationReply>;
const identity = (e: { eventType?: unknown; transactionId?: unknown }) => JSON.stringify([e.eventType, e.transactionId]);

/** Why a period cannot be declared at all, or null. Nothing is read or sent for a refused period. */
export function refusePeriod(config: MarketingConfig, period: CashPeriod, now: Date): string | null {
  try { cashTime(period.from); cashTime(period.to); } catch { return "period_invalid"; }
  const from = Date.parse(period.from), to = Date.parse(period.to);
  if (from >= to) return "period_invalid";
  if (from < config.from.getTime()) return "period_before_activation";
  if (to > now.getTime()) return "period_in_future";
  if (to - from > MAX_DAYS * DAY_MS) return "period_too_long";
  return null;
}

/** The delivered events inside the period, each alias once, with the values of the saved bytes that were sent. */
export function declareCashPeriod(config: MarketingConfig, period: CashPeriod, rows: DeliveredRow[]): { refusal: string | null; entries: ReconciliationEntry[] } {
  const events = new Map<string, { entry: ReconciliationEntry; digest: string; receiptId: string | null }>();
  for (const row of rows) {
    if (row.environment !== config.environment) return { refusal: "source_conflict", entries: [] };
    let event: ReturnType<typeof normalizeMarketingCash>;
    try { event = normalizeMarketingCash(row.payload ?? ""); } catch { return { refusal: "payload_invalid", entries: [] }; }
    if (event.eventType !== row.kind) return { refusal: "payload_invalid", entries: [] };
    const seen = events.get(event.businessIdentity);
    if (seen && (seen.digest !== event.semanticDigest || seen.receiptId !== row.receiptId)) return { refusal: "alias_conflict", entries: [] };
    if (!seen) events.set(event.businessIdentity, { digest: event.semanticDigest, receiptId: row.receiptId,
      entry: { eventType: event.eventType, transactionId: event.transactionId, amountMinor: event.amountMinor, currency: event.currency, occurredAt: event.occurredAt } });
  }
  // An original payment outside the period is never declared, even when its refund is inside.
  const entries = [...events.keys()].sort().map(key => events.get(key)!.entry).filter(e => e.occurredAt >= period.from && e.occurredAt < period.to);
  return { refusal: entries.length > RECONCILIATION_MAX_ENTRIES ? "too_many_entries" : null, entries };
}

export function reconciliationBody(period: CashPeriod, entries: ReconciliationEntry[]): string {
  return JSON.stringify({ schemaVersion: 2, period: { from: period.from, to: period.to }, complete: true, entries });
}

/** Strict: the reply must describe this binding, this period and only identifiers this request declared. */
export function validateReconciliationReply(input: unknown, expected: CashBinding, period: CashPeriod, entries: ReconciliationEntry[]) {
  const v = cashObject(input, ["schemaVersion", "sourceId", "environment", "keyId", "capabilities", "project", "period", "observation", "agreeing", "declared", "notReceived", "notDeclared", "reconciliationId"]);
  cashAssert(v.schemaVersion === 2 && v.sourceId === expected.sourceId && v.environment === expected.environment && v.keyId === expected.keyId);
  cashAssert(Array.isArray(v.capabilities) && v.capabilities.every(c => typeof c === "string") && JSON.stringify([...v.capabilities].sort()) === JSON.stringify(expected.capabilities));
  const project = cashObject(v.project, ["projectId", "version"]);
  cashAssert(project.projectId === expected.project.projectId && project.version === expected.project.version);
  const echoed = cashObject(v.period, ["from", "to"]);
  cashAssert(echoed.from === period.from && echoed.to === period.to);
  const observation = cashObject(v.observation, ["startedAt", "completedAt"]);
  cashAssert(cashTime(observation.startedAt) <= cashTime(observation.completedAt));
  const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
  const declared = cashObject(v.declared, ["purchases", "refunds"]);
  cashAssert(declared.purchases === entries.filter(e => e.eventType === "purchase").length && declared.refunds === entries.filter(e => e.eventType === "refund").length);
  const notReceived = cashObject(v.notReceived, ["count", "entries"]);
  cashAssert(count(notReceived.count) && notReceived.count <= entries.length && Array.isArray(notReceived.entries) && notReceived.entries.length === Math.min(notReceived.count, LISTED));
  const sent = new Set(entries.map(identity)), listed = new Set<string>();
  for (const item of notReceived.entries) {
    const r = cashObject(item, ["eventType", "transactionId", "status"]);
    cashAssert(sent.has(identity(r)) && !listed.has(identity(r)) && (r.status === "missing" || r.status === "mismatch"));
    listed.add(identity(r));
  }
  const notDeclared = cashObject(v.notDeclared, ["purchases", "refunds"]);
  cashAssert(count(notDeclared.purchases) && count(notDeclared.refunds));
  const agreeing = notReceived.count === 0 && notDeclared.purchases === 0 && notDeclared.refunds === 0;
  cashAssert(v.agreeing === agreeing && (agreeing ? typeof v.reconciliationId === "string" && UUID.test(v.reconciliationId) : v.reconciliationId === null));
  return { agreeing, reconciliationId: v.reconciliationId as string | null, observation: { startedAt: observation.startedAt as string, completedAt: observation.completedAt as string },
    notReceived: { count: notReceived.count },
    notDeclared: { purchases: notDeclared.purchases, refunds: notDeclared.refunds } };
}

async function readBounded(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader(); cashAssert(reader);
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.length;
    if (size > max) { void reader.cancel().catch(() => {}); cashAssert(false); }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

type Exchange = { outcome: string; sent: boolean; receiverStatus: number | null; responseDigest: string | null; field: string | null; reply: Reply | null };

/** One identity preflight and at most one POST to the fixed receiver. No retry, redirect, cookie or mutation. */
export async function sendCashReconciliation(config: MarketingConfig, expected: CashBinding, period: CashPeriod, entries: ReconciliationEntry[], send: typeof fetch = fetch): Promise<Exchange> {
  const body = reconciliationBody(period, entries);
  const none = { sent: false, receiverStatus: null, responseDigest: null, field: null, reply: null };
  if (Buffer.byteLength(body) > MAX_BODY) return { ...none, outcome: "body_too_large" };
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let sent = false;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, TIMEOUT_MS); });
  const base = { redirect: "error" as const, credentials: "omit" as const, cache: "no-store" as const, signal: controller.signal };
  try {
    return await Promise.race([deadline, (async (): Promise<Exchange> => {
      const preflight = await send(new Request(`${MARKETING_RECEIVER}/identity`, { ...base, headers: { Authorization: `Bearer ${config.serverKey}` } }));
      if (preflight.status !== 200) { await preflight.body?.cancel().catch(() => {}); return { ...none, outcome: "receiver_identity_unavailable", receiverStatus: preflight.status }; }
      try {
        const id = cashObject(JSON.parse(await readBounded(preflight, MAX_REPLY)), ["schemaVersion", "sourceId", "environment", "keyId", "capabilities"]);
        cashAssert(id.schemaVersion === 1 && id.sourceId === expected.sourceId && id.environment === expected.environment && id.keyId === expected.keyId);
        cashAssert(Array.isArray(id.capabilities) && id.capabilities.every(c => typeof c === "string") && JSON.stringify([...id.capabilities].sort()) === JSON.stringify(expected.capabilities));
      } catch { return { ...none, outcome: "receiver_identity_mismatch", receiverStatus: 200 }; }
      // A timed-out preflight must never resume into the declaration.
      controller.signal.throwIfAborted();
      sent = true;
      const response = await send(new Request(`${MARKETING_RECEIVER}/receipts/compare`, { ...base, method: "POST", headers: { Authorization: `Bearer ${config.serverKey}`, "Content-Type": "application/json" }, body }));
      const result = { sent, receiverStatus: response.status, responseDigest: null as string | null, field: null as string | null, reply: null as Reply | null };
      let raw: string;
      try { cashAssert(!response.headers.has("set-cookie")); raw = await readBounded(response, MAX_REPLY); } catch { return { ...result, outcome: "receiver_reply_invalid" }; }
      result.responseDigest = cashDigest(raw);
      if (response.status === 200) {
        try { result.reply = validateReconciliationReply(JSON.parse(raw), expected, period, entries); } catch { return { ...result, outcome: "receiver_reply_invalid" }; }
        return { ...result, outcome: result.reply.agreeing ? "agreed" : "disagreed" };
      }
      // Only fixed codes and field names are kept; a response body is never a safe diagnostic.
      let code: unknown, field: unknown;
      try { ({ code, field } = (JSON.parse(raw) as { error: { code?: unknown; field?: unknown } }).error); } catch { /* the HTTP status is the reason */ }
      if (typeof field === "string" && RECEIVER_FIELDS.includes(field)) result.field = field;
      return { ...result, outcome: typeof code === "string" && RECEIVER_CODES.includes(code) ? `receiver_${code.toLowerCase()}` : `receiver_http_${response.status}` };
    })()]);
  } catch {
    // After the POST started the receiver may have saved a reconciliation; the answer is unknown and is not asked again.
    return { ...none, sent, outcome: sent ? "receiver_unavailable" : "receiver_identity_unavailable" };
  } finally { clearTimeout(timer); controller.abort(); }
}

/**
 * Declares `[from, to)` complete when the retained billing ledger has no gap, without a processor check
 * (the owner's decision of 15 November 2026). Reads only; billing, ledger, outbox and credit balances never change.
 * Every result carries a stable `outcome`; all but a refused period are appended as an immutable observation.
 */
export async function reconcileCashPeriod(config: MarketingConfig, binding: CashBinding, period: CashPeriod, send: typeof fetch = fetch, now = new Date(), requestedFrom: string | null = null) {
  cashBinding(config, JSON.stringify(binding));
  const refused = refusePeriod(config, period, now);
  if (refused) return { outcome: refused, sent: false, observation: null };
  const startedAt = new Date().toISOString();
  const cash = { sourceId: config.sourceId, kind: { in: ["purchase", "refund"] } };
  const read = await prisma.$transaction(async tx => {
    const notCaptured = await readMarketingLedger(tx, config.from, 1, config.sourceId);
    const waiting = await tx.marketingConversion.groupBy({ by: ["status"], where: { ...cash, status: { not: "delivered" }, OR: [{ sourceCreatedAt: { gte: config.from } }, { createdAt: { gte: config.from } }] }, _count: { _all: true } });
    // A ledger row is written after its charge or refund, so an event inside the period was captured at or after `from`; a day covers clock skew.
    // Known limit: this reads every delivered cash row since the period start in one query. Page it if one window ever holds tens of thousands.
    const since = new Date(Date.parse(period.from) - DAY_MS);
    const rows = await tx.marketingConversion.findMany({ where: { ...cash, status: "delivered", OR: [{ sourceCreatedAt: { gte: since } }, { createdAt: { gte: since } }] },
      select: { kind: true, environment: true, payload: true, receiptId: true }, orderBy: { id: "asc" } });
    return { ledgerFactNotCaptured: notCaptured.length > 0, undelivered: Object.fromEntries(waiting.map(w => [w.status, w._count._all])) as Record<string, number>, rows };
  }, { isolationLevel: "RepeatableRead", timeout: 15000 });
  const { refusal: undeclarable, entries } = declareCashPeriod(config, period, read.rows);
  const refusal = read.ledgerFactNotCaptured ? "ledger_fact_not_captured" : read.undelivered.blocked ? "delivery_blocked"
    : Object.keys(read.undelivered).length ? "delivery_pending" : undeclarable;
  // The earliest start whose window to `to` holds at most the limit, for a caller that chooses a shorter period.
  const overflow = refusal === "too_many_entries" ? entries.map(e => e.occurredAt).sort().reverse()[RECONCILIATION_MAX_ENTRIES]! : null;
  const fitsFrom = overflow ? new Date(Date.parse(overflow) + 1).toISOString() : null;
  const exchange = refusal ? null : await sendCashReconciliation(config, binding, period, entries, send);
  const observation = await append(prisma, config, "comparison", null, {
    contract: "receipt-reconciliation/v2", basis: "retained-ledger", binding, activationFrom: config.from.toISOString(), period, requestedFrom,
    outcome: exchange?.outcome ?? refusal, sent: exchange?.sent ?? false,
    declared: refusal ? null : { purchases: entries.filter(e => e.eventType === "purchase").length, refunds: entries.filter(e => e.eventType === "refund").length },
    requestDigest: exchange?.sent ? cashDigest(reconciliationBody(period, entries)) : null, responseDigest: exchange?.responseDigest ?? null,
    receiverStatus: exchange?.receiverStatus ?? null, receiverField: exchange?.field ?? null, reconciliationId: exchange?.reply?.reconciliationId ?? null, receiver: exchange?.reply ?? null,
    ledgerFactNotCaptured: read.ledgerFactNotCaptured, undelivered: read.undelivered, fitsFrom: fitsFrom && fitsFrom < period.to ? fitsFrom : null,
    upstreamCompleteness: "unknown", limitations: LIMITATIONS, producerObservation: { startedAt, completedAt: new Date().toISOString() },
  });
  return { outcome: observation.document.outcome as string, sent: observation.document.sent as boolean, observation };
}

/** The widest window ending two hours before `now`: back to activation, at most 92 days, moved forward only when it holds too many entries. */
export async function reconcileTrailingCashWindow(config: MarketingConfig, binding: CashBinding, now = new Date(), send: typeof fetch = fetch) {
  const to = now.getTime() - SETTLE_MS, from = Math.max(config.from.getTime(), to - MAX_DAYS * DAY_MS);
  if (from >= to) return { outcome: "period_before_activation", sent: false, observation: null };
  const widest = { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
  const first = await reconcileCashPeriod(config, binding, widest, send, now);
  const fitsFrom = first.observation?.document.fitsFrom as string | null | undefined;
  if (first.outcome !== "too_many_entries" || !fitsFrom) return first;
  return reconcileCashPeriod(config, binding, { from: fitsFrom, to: widest.to }, send, now, widest.from);
}

/**
 * Off unless delivery and this separate flag are both on for the hosted application.
 * `selfHosted` is the shared server-side boundary: it sees the build-time flag of the official self-hosted image,
 * which a lookup on a passed `env` object cannot.
 */
export function cashReconciliationEnabled(env: Record<string, string | undefined>, selfHosted = isSelfHosted()): boolean {
  return !selfHosted && env.UNIFIED_ADS_ENABLED === "true" && env.UNIFIED_ADS_RECONCILIATION_ENABLED === "true"
    && env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED !== "true" && env.OCTOPUS_SELF_HOSTED !== "true";
}

/** Daily at 05:30 UTC on engine replicas, so the window ends at 03:30 UTC. */
export async function scheduleCashReconciliation(boss: { schedule(name: string, cron: string, data: object, options: { tz: string }): Promise<unknown>; unschedule(name: string): Promise<unknown> }, env: Record<string, string | undefined> = process.env) {
  if (cashReconciliationEnabled(env)) await boss.schedule("marketing-reconciliation", "30 5 * * *", {}, { tz: "UTC" });
  else await boss.unschedule("marketing-reconciliation");
}

/** The scheduled job. Rechecks its flag before reading any product fact. */
export async function runCashReconciliation(env: Record<string, string | undefined> = process.env, now = new Date(), send: typeof fetch = fetch) {
  const none = { sent: false, observation: null };
  if (!cashReconciliationEnabled(env)) return { ...none, outcome: "disabled" };
  const config = resolveMarketingConfig(env);
  if (!config) return { ...none, outcome: "disabled" };
  if (config.environment !== "live" && env.NODE_ENV === "production") return { ...none, outcome: "production_requires_live_source" };
  let binding: CashBinding;
  try { binding = cashBinding(config, env.UNIFIED_ADS_CASH_EXPECTED_BINDING); } catch { return { ...none, outcome: "binding_invalid" }; }
  return reconcileTrailingCashWindow(config, binding, now, send);
}
