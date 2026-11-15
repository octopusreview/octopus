import { describe, it, expect, mock } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import type { MarketingConfig } from "../marketing-conversions";
import { cashBinding } from "../marketing-cash-compare";
mock.module("server-only", () => ({}));
mock.module("@octopus/db", () => ({ prisma: {} }));
const { cashReconciliationEnabled, declareCashPeriod, reconciliationBody, refusePeriod, runCashReconciliation, scheduleCashReconciliation, sendCashReconciliation, validateReconciliationReply } = await import("../marketing-cash-reconcile");

const keyId = randomUUID();
const config: MarketingConfig = { sourceId: randomUUID(), environment: "test", serverKey: `uads_${keyId}_${"a".repeat(43)}`, from: new Date("2026-09-01T00:00:00.000Z") };
const binding = cashBinding(config, JSON.stringify({ sourceId: config.sourceId, environment: "test", keyId, capabilities: ["purchases", "refunds"], project: { projectId: randomUUID(), version: 3 } }));
const period = { from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" };
const envelope = '{"schemaVersion":2,"period":{"from":"2026-10-01T00:00:00.000Z","to":"2026-10-08T00:00:00.000Z"},"complete":true,"entries":[';
const receiptId = randomUUID();
const delivered = (kind: string, payload: object, receipt = receiptId) => ({ kind, environment: "test", payload: JSON.stringify(payload), receiptId: receipt });
const purchase = (id = "payment_a", occurredAt = "2026-10-03T14:07:11.000Z", amountMinor = "4900") =>
  delivered("purchase", { schemaVersion: 1, eventId: id, eventType: "purchase", transactionId: id, customerId: "organization_a", occurredAt, amountMinor, currency: "GBP", purchaseKind: "top_up" });
const refund = (original = "payment_a") =>
  delivered("refund", { schemaVersion: 1, eventId: "refund_a", eventType: "refund", transactionId: "refund_a", originalTransactionId: original, customerId: "organization_a", amountMinor: "1000", currency: "GBP", occurredAt: "2026-10-04T09:00:00.000Z" });
const PURCHASE = '{"eventType":"purchase","transactionId":"payment_a","amountMinor":"4900","currency":"GBP","occurredAt":"2026-10-03T14:07:11.000Z"}';
const REFUND = '{"eventType":"refund","transactionId":"refund_a","amountMinor":"1000","currency":"GBP","occurredAt":"2026-10-04T09:00:00.000Z"}';
const body = (rows: ReturnType<typeof delivered>[]) => { const d = declareCashPeriod(config, period, rows); expect(d.refusal).toBeNull(); return reconciliationBody(period, d.entries); };
const many = (count: number) => Array.from({ length: count }, (_, i) => delivered("purchase", { schemaVersion: 1, eventId: `e${i}`, eventType: "purchase",
  transactionId: `payment_${String(i).padStart(4, "0")}`, customerId: "organization_a", occurredAt: new Date(Date.parse(period.from) + i * 1000).toISOString(), amountMinor: "100", currency: "USD", purchaseKind: "top_up" }));

const identityReply = () => Response.json({ schemaVersion: 1, sourceId: binding.sourceId, environment: binding.environment, keyId, capabilities: binding.capabilities });
function reply(entries: { eventType: string; transactionId: string }[], change: Record<string, unknown> = {}) {
  return { schemaVersion: 2, ...binding, period, observation: { startedAt: "2026-10-09T09:00:00.120Z", completedAt: "2026-10-09T09:00:00.134Z" }, agreeing: true,
    declared: { purchases: entries.filter(e => e.eventType === "purchase").length, refunds: entries.filter(e => e.eventType === "refund").length },
    notReceived: { count: 0, entries: [] }, notDeclared: { purchases: 0, refunds: 0 }, reconciliationId: randomUUID(), ...change };
}
/** Synthetic transport: records every request and never touches the network. */
function transport(post: (request: Request) => Response | Promise<Response>, identity: () => Response | Promise<Response> = identityReply) {
  const requests: { method: string; url: string; body: string }[] = [];
  const send = (async (input: RequestInfo | URL) => {
    const request = input as Request;
    expect(request.redirect).toBe("error"); expect(request.headers.has("cookie")).toBe(false); expect(request.headers.has("origin")).toBe(false);
    expect(request.headers.get("authorization")).toBe(`Bearer ${config.serverKey}`);
    requests.push({ method: request.method, url: request.url, body: request.method === "POST" ? await request.clone().text() : "" });
    return request.method === "GET" ? identity() : post(request);
  }) as typeof fetch;
  return { send, requests };
}

describe("complete-period reconciliation", () => {
  it("refuses a period that is malformed, before activation, unfinished or longer than 92 days", () => {
    const now = new Date("2026-12-31T00:00:00.000Z");
    expect(refusePeriod(config, period, now)).toBeNull();
    expect(refusePeriod(config, { from: "2026-09-01T00:00:00.000Z", to: "2026-12-02T00:00:00.000Z" }, now)).toBeNull();
    for (const [from, to, reason] of [
      ["2026-10-01T00:00:00Z", period.to, "period_invalid"], ["2026-10-01", period.to, "period_invalid"], [period.to, period.from, "period_invalid"], [period.from, period.from, "period_invalid"],
      ["2026-08-31T23:59:59.999Z", period.to, "period_before_activation"], [period.from, "2026-12-31T00:00:00.001Z", "period_in_future"],
      ["2026-09-01T00:00:00.000Z", "2026-12-02T00:00:00.001Z", "period_too_long"],
    ]) expect(refusePeriod(config, { from: from!, to: to! }, now)).toBe(reason!);
  });

  it("declares byte-exact bodies for a purchase, a refund, aliases, an out-of-period original and an empty period", () => {
    expect(body([purchase()])).toBe(`${envelope}${PURCHASE}]}`);
    // The saved bytes may omit the fraction; the receiver holds, and is told, the three-digit instant.
    expect(body([purchase("payment_a", "2026-10-03T14:07:11Z")])).toBe(`${envelope}${PURCHASE}]}`);
    expect(body([refund(), purchase()])).toBe(`${envelope}${PURCHASE},${REFUND}]}`);
    // A Checkout and a PaymentIntent origin of one payment are one event.
    expect(body([purchase(), purchase(), refund()])).toBe(`${envelope}${PURCHASE},${REFUND}]}`);
    // The refund is inside the period, its original payment is not: only the refund is declared.
    expect(body([refund("payment_old"), purchase("payment_old", "2026-09-30T23:59:59.999Z")])).toBe(`${envelope}${REFUND}]}`);
    // Half-open: an event at `from` is inside, one at `to` is not.
    expect(body([purchase("payment_a", period.from)])).toContain(`"occurredAt":"${period.from}"`);
    expect(body([purchase("payment_a", period.to)])).toBe(`${envelope}]}`);
    expect(body([])).toBe(`${envelope}]}`);
  });

  it("declares exactly 1,000 entries and refuses 1,001", () => {
    const full = body(many(1000));
    expect(Buffer.byteLength(full)).toBe(133124);
    expect(createHash("sha256").update(full).digest("hex")).toBe("cc5d05e6ee4f8bac5a109d79c7d9d64a4c37e31cd88f72005d5555d06fb16475");
    const over = declareCashPeriod(config, period, many(1001));
    expect(over.refusal).toBe("too_many_entries"); expect(over.entries).toHaveLength(1001);
  });

  it("refuses conflicting aliases, unreadable bytes and a foreign environment instead of declaring them", () => {
    const refusal = (rows: ReturnType<typeof delivered>[]) => declareCashPeriod(config, period, rows);
    expect(refusal([purchase(), purchase("payment_a", "2026-10-03T14:07:11.000Z", "4901")])).toEqual({ refusal: "alias_conflict", entries: [] });
    expect(refusal([purchase(), { ...purchase(), receiptId: randomUUID() }])).toEqual({ refusal: "alias_conflict", entries: [] });
    expect(refusal([{ ...purchase(), payload: "{}" }])).toEqual({ refusal: "payload_invalid", entries: [] });
    expect(refusal([{ ...purchase(), payload: null }])).toEqual({ refusal: "payload_invalid", entries: [] });
    expect(refusal([{ ...purchase(), kind: "refund" }])).toEqual({ refusal: "payload_invalid", entries: [] });
    expect(refusal([{ ...purchase(), environment: "live" }])).toEqual({ refusal: "source_conflict", entries: [] });
  });

  it("accepts only a reply about this binding, this period and the identifiers it declared", () => {
    const { entries } = declareCashPeriod(config, period, [purchase(), refund()]);
    const missing = { count: 1, entries: [{ eventType: "refund", transactionId: "refund_a", status: "missing" }] };
    const disagree = { agreeing: false, reconciliationId: null };
    expect(validateReconciliationReply(reply(entries), binding, period, entries).agreeing).toBe(true);
    expect(validateReconciliationReply(reply(entries, { ...disagree, notReceived: missing }), binding, period, entries)).toMatchObject({ agreeing: false, reconciliationId: null, notReceived: { count: 1 } });
    expect(validateReconciliationReply(reply(entries, { ...disagree, notReceived: missing }), binding, period, entries).notReceived).toEqual({ count: 1 });
    expect(validateReconciliationReply(reply(entries, { ...disagree, notDeclared: { purchases: 2, refunds: 1 } }), binding, period, entries).notDeclared).toEqual({ purchases: 2, refunds: 1 });
    for (const change of [
      { schemaVersion: 1 }, { sourceId: randomUUID() }, { environment: "live" }, { keyId: randomUUID() }, { capabilities: ["purchases"] },
      { project: { projectId: null, version: 0 } }, { project: { ...binding.project, version: 4 } }, { period: { ...period, to: "2026-10-09T00:00:00.000Z" } },
      { observation: { startedAt: "2026-10-09T09:00:01.000Z", completedAt: "2026-10-09T09:00:00.000Z" } }, { declared: { purchases: 2, refunds: 1 } },
      { extra: true }, { reconciliationId: null }, { reconciliationId: "not-a-uuid" }, { agreeing: false },
      { ...disagree, notReceived: missing, reconciliationId: randomUUID() }, { notReceived: missing }, { ...disagree },
      { ...disagree, notReceived: { count: 1, entries: [] } }, { ...disagree, notReceived: { count: 3, entries: missing.entries } },
      { ...disagree, notReceived: { count: 1, entries: [{ eventType: "refund", transactionId: "refund_other", status: "missing" }] } },
      { ...disagree, notReceived: { count: 2, entries: [missing.entries[0], missing.entries[0]] } },
      { ...disagree, notReceived: { count: 1, entries: [{ ...missing.entries[0], status: "matched" }] } },
      { ...disagree, notReceived: { count: 1, entries: [{ ...missing.entries[0], amountMinor: "1" }] } },
      { ...disagree, notDeclared: { purchases: -1, refunds: 0 } }, { ...disagree, notDeclared: { purchases: 1 } },
    ]) expect(() => validateReconciliationReply(reply(entries, change), binding, period, entries)).toThrow();
  });

  it("sends one identity check and one declaration to the fixed receiver and reads agreement and both kinds of disagreement", async () => {
    const { entries } = declareCashPeriod(config, period, [purchase(), refund()]);
    const agreed = transport(() => Response.json(reply(entries)));
    const result = await sendCashReconciliation(config, binding, period, entries, agreed.send);
    expect(result).toMatchObject({ outcome: "agreed", sent: true, receiverStatus: 200 });
    expect(result.reply!.reconciliationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(agreed.requests).toEqual([
      { method: "GET", url: "https://ads.weezboo.com/api/conversion-events/identity", body: "" },
      { method: "POST", url: "https://ads.weezboo.com/api/conversion-events/receipts/compare", body: `${envelope}${PURCHASE},${REFUND}]}` },
    ]);
    const mismatch = { count: 1, entries: [{ eventType: "purchase", transactionId: "payment_a", status: "mismatch" }] };
    for (const change of [{ notReceived: mismatch }, { notDeclared: { purchases: 0, refunds: 1 } }]) {
      const t = transport(() => Response.json(reply(entries, { agreeing: false, reconciliationId: null, ...change })));
      const disagreed = await sendCashReconciliation(config, binding, period, entries, t.send);
      expect(disagreed).toMatchObject({ outcome: "disagreed", sent: true, reply: { reconciliationId: null, ...(change.notReceived ? { notReceived: { count: 1 } } : change) } });
      expect(t.requests.map(r => r.method)).toEqual(["GET", "POST"]);
    }
    const empty = transport(() => Response.json(reply([])));
    expect((await sendCashReconciliation(config, binding, period, [], empty.send)).outcome).toBe("agreed");
    expect(empty.requests[1]!.body).toBe(`${envelope}]}`);
  });

  it("names every receiver error once, without a retry", async () => {
    const { entries } = declareCashPeriod(config, period, [purchase()]);
    const outcome = async (post: () => Response | Promise<Response>, identity?: () => Response | Promise<Response>) => {
      const t = transport(post, identity); const result = await sendCashReconciliation(config, binding, period, entries, t.send);
      return [result.outcome, result.sent, t.requests.map(r => r.method).join(" "), result.field] as const;
    };
    const error = (status: number, code: string, field?: string) => () => Response.json({ error: { code, field, message: "not kept" } }, { status });
    for (const [status, code] of [[400, "INVALID_HOST"], [400, "INVALID_RECEIPT_COMPARISON"], [400, "RECEIPT_SET_TOO_LARGE"], [401, "INVALID_SOURCE_KEY"], [403, "SERVER_INTEGRATION_ONLY"],
      [405, "METHOD_NOT_ALLOWED"], [413, "BODY_TOO_LARGE"], [415, "INVALID_CONTENT_TYPE"], [429, "CONVERSION_BUSY"], [503, "UPSTREAM_UNAVAILABLE"]] as const) {
      expect(await outcome(error(status, code))).toEqual([`receiver_${code.toLowerCase()}`, true, "GET POST", null]);
    }
    expect(await outcome(error(400, "INVALID_RECEIPT_RECONCILIATION", "occurredAt"))).toEqual(["receiver_invalid_receipt_reconciliation", true, "GET POST", "occurredAt"]);
    expect(await outcome(error(400, "INVALID_RECEIPT_RECONCILIATION", "<script>"))).toEqual(["receiver_invalid_receipt_reconciliation", true, "GET POST", null]);
    expect(await outcome(error(500, "SOMETHING_ELSE"))).toEqual(["receiver_http_500", true, "GET POST", null]);
    expect(await outcome(() => new Response("<html>", { status: 502 }))).toEqual(["receiver_http_502", true, "GET POST", null]);
    // A malformed, oversized, cookie-setting or foreign 200 is not an answer.
    expect(await outcome(() => new Response("not json"))).toEqual(["receiver_reply_invalid", true, "GET POST", null]);
    expect(await outcome(() => new Response(JSON.stringify(reply(entries)) + " ".repeat(16384)))).toEqual(["receiver_reply_invalid", true, "GET POST", null]);
    expect(await outcome(() => Response.json(reply(entries), { headers: { "set-cookie": "a=b" } }))).toEqual(["receiver_reply_invalid", true, "GET POST", null]);
    expect(await outcome(() => Response.json(reply(entries, { keyId: randomUUID() })))).toEqual(["receiver_reply_invalid", true, "GET POST", null]);
    expect(await outcome(() => { throw new Error("synthetic network failure"); })).toEqual(["receiver_unavailable", true, "GET POST", null]);
    // Headers arrived, then the connection failed while the body was being read: the answer is lost, not malformed.
    expect(await outcome(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); controller.error(new Error("synthetic stream failure")); } })))).toEqual(["receiver_unavailable", true, "GET POST", null]);
    // Nothing is declared to a receiver that does not identify as the expected source and key.
    const never = () => { throw new Error("must not send"); };
    expect(await outcome(never, () => new Response("", { status: 503 }))).toEqual(["receiver_identity_unavailable", false, "GET", null]);
    expect(await outcome(never, () => { throw new Error("synthetic network failure"); })).toEqual(["receiver_identity_unavailable", false, "GET", null]);
    expect(await outcome(never, () => Response.json({ schemaVersion: 1, sourceId: randomUUID(), environment: "test", keyId, capabilities: binding.capabilities }))).toEqual(["receiver_identity_mismatch", false, "GET", null]);
    expect(await outcome(never, () => Response.json({ schemaVersion: 1, sourceId: binding.sourceId, environment: "test", keyId, capabilities: ["purchases"] }))).toEqual(["receiver_identity_mismatch", false, "GET", null]);
  });

  it("schedules the daily job only with its own flag on the hosted application", async () => {
    const on = { UNIFIED_ADS_ENABLED: "true", UNIFIED_ADS_RECONCILIATION_ENABLED: "true" };
    const calls = async (env: Record<string, string | undefined>) => {
      const seen: unknown[][] = [];
      await scheduleCashReconciliation({ schedule: async (...args) => { seen.push(["schedule", ...args]); }, unschedule: async (...args) => { seen.push(["unschedule", ...args]); } }, env);
      return seen;
    };
    expect(await calls(on)).toEqual([["schedule", "marketing-reconciliation", "30 5 * * *", {}, { tz: "UTC" }]]);
    for (const env of [{}, { UNIFIED_ADS_ENABLED: "true" }, { UNIFIED_ADS_RECONCILIATION_ENABLED: "true" }, { ...on, UNIFIED_ADS_RECONCILIATION_ENABLED: "1" },
      { ...on, OCTOPUS_SELF_HOSTED: "true" }, { ...on, NEXT_PUBLIC_OCTOPUS_SELF_HOSTED: "true" }]) {
      expect(cashReconciliationEnabled(env)).toBe(false);
      expect(await calls(env)).toEqual([["unschedule", "marketing-reconciliation"]]);
      // The worker rechecks the flag: no configuration, database or receiver is touched.
      expect(await runCashReconciliation(env, new Date(), (async () => { throw new Error("must not send"); }) as unknown as typeof fetch)).toEqual({ outcome: "disabled", sent: false, observation: null });
    }
    // The official self-hosted image carries its flag from the build, not in the environment the job is handed.
    expect(cashReconciliationEnabled(on, true)).toBe(false);
    expect(cashReconciliationEnabled(on, false)).toBe(true);
    const built = process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED;
    process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED = "true";
    try {
      expect(cashReconciliationEnabled(on)).toBe(false);
      expect(await calls(on)).toEqual([["unschedule", "marketing-reconciliation"]]);
      expect(await runCashReconciliation(on, new Date(), (async () => { throw new Error("must not send"); }) as unknown as typeof fetch)).toEqual({ outcome: "disabled", sent: false, observation: null });
    } finally {
      if (built === undefined) delete process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED; else process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED = built;
    }
  });
});
