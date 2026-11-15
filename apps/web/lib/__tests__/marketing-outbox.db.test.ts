import { afterAll, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Client } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { conversionId, type MarketingConfig } from "../marketing-conversions";
import { trackingIdentity, TRACKING_MODEL, type TrackingConfig } from "../marketing-tracking";
import { fixture } from "./fixtures/marketing-stripe";

const enabled = process.env.RUN_MARKETING_DB_TESTS === "1";
const originalUrl = process.env.DATABASE_URL;
const databaseName = `marketing_test_${randomUUID().replaceAll("-", "")}`;
const config: MarketingConfig = { sourceId: randomUUID(), environment: "test", serverKey: "synthetic-test-key", from: new Date("2026-09-09T00:00:00Z") };
const receiptId = randomUUID();
let admin: Client;
let db: Client;
let prisma: (typeof import("@octopus/db"))["prisma"];
let outbox: typeof import("../marketing-outbox");
let created = false;
let testUrl: string;
const received = (duplicate = false) => new Response(JSON.stringify({ receiptId, duplicate, status: "stored", attribution: "not_established" }), { status: duplicate ? 200 : 201 });
function withIdentity(send: (request: Request) => Promise<Response>): (request: Request) => Promise<Response> {
  return async request => request.method === "GET"
    ? Response.json({ schemaVersion: 1, sourceId: config.sourceId, environment: config.environment, keyId: receiptId, capabilities: ["registrations", "purchases", "refunds"] })
    : send(request);
}
async function user(id = "test_user", date = new Date()) {
  await db.query('INSERT INTO users (id, "createdAt") VALUES ($1, $2)', [id, date]);
}
async function ledger(id: string, type: string, payment: string | null, refund: string | null = null) {
  await db.query('INSERT INTO credit_transactions (id, "createdAt", "organizationId", type, "stripeSessionId", "stripeRefundId") VALUES ($1, NOW(), $2, $3, $4, $5)', [id, "org_fixture", type, payment, refund]);
}
async function due(id: string) {
  await prisma.marketingConversion.update({ where: { id }, data: { nextAttemptAt: new Date(0) } });
}

(enabled ? describe : describe.skip)("Unified Ads outbox with the actual PostgreSQL migration", () => {
  beforeAll(async () => {
    const url = new URL(originalUrl ?? "http://invalid");
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/(^|[-_])test($|[-_])/.test(url.pathname.slice(1))) {
      throw new Error("Marketing DB tests require a local dedicated test database");
    }
    admin = new Client({ connectionString: url.toString() });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    url.pathname = `/${databaseName}`;
    testUrl = url.toString();
    db = new Client({ connectionString: testUrl });
    await db.connect();
    // Minimal pre-migration source tables. All outbox DDL and constraints come
    // from the shipped SQL, rather than db push or a test copy of that schema.
    await db.query('CREATE TABLE users (id TEXT PRIMARY KEY, "createdAt" TIMESTAMP(3) NOT NULL); CREATE TABLE credit_transactions (id TEXT PRIMARY KEY, "createdAt" TIMESTAMP(3) NOT NULL, "organizationId" TEXT NOT NULL, type TEXT NOT NULL, "stripeSessionId" TEXT, "stripeRefundId" TEXT)');
    await db.query(await readFile(new URL("../../../../packages/db/prisma/migrations/20260915140000_marketing_conversion_outbox/migration.sql", import.meta.url), "utf8"));
    await db.query(await readFile(new URL("../../../../packages/db/prisma/migrations/20260917100000_marketing_tracking_outbox/migration.sql", import.meta.url), "utf8"));
    await db.query(await readFile(new URL("../../../../packages/db/prisma/migrations/20260917110000_marketing_capture/migration.sql", import.meta.url), "utf8"));
    await db.query(await readFile(new URL("../../../../packages/db/prisma/migrations/20260922140000_marketing_cash_observations/migration.sql", import.meta.url), "utf8"));
    await db.query('CREATE TABLE organizations (id TEXT PRIMARY KEY, "stripeCustomerId" TEXT, name TEXT, "billingEmail" TEXT, slug TEXT)');
    process.env.DATABASE_URL = testUrl;
    mock.module("server-only", () => ({}));
    ({ prisma } = await import("@octopus/db"));
    outbox = await import("../marketing-outbox");
  });
  // DROP DATABASE can wait for a PostgreSQL checkpoint on shared CI storage.
  afterAll(async () => {
    await prisma?.$disconnect();
    await db?.end();
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    await admin?.end();
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  }, 30_000);
  beforeEach(async () => {
    await db.query("TRUNCATE organizations, marketing_payment_attributions, marketing_conversions, users, credit_transactions");
  });

  it("persists immutable retained observations after actual capture/dispatch and supersedes late facts", async () => {
    const observation = await import("../marketing-cash-observation");
    const binding = { sourceId: config.sourceId, environment: "test" as const, keyId: receiptId, capabilities: ["purchases", "refunds"], project: { projectId: randomUUID(), version: 7 } };
    const scoped = { ...config, serverKey: `uads_${receiptId}_${"a".repeat(43)}` };
    await ledger("observed_cash", "purchase", "pi_fixture");
    await outbox.captureMarketingConversions(config);
    const captured = (await outbox.claimMarketingConversion(config))!;
    const f = fixture();
    await outbox.processMarketingConversion(captured, config, f.reader, withIdentity(async () => received()));
    const scope = { from: config.from.toISOString(), to: new Date().toISOString() };
    const first = await observation.createCashInventory(scoped, binding, scope);
    expect(first.document.B).toBe("complete_retained_scope");
    expect(first.document.members).toHaveLength(1);
    await expect(db.query('UPDATE marketing_cash_observations SET body=$1 WHERE id=$2', ["{}", first.id])).rejects.toThrow();
    await expect(db.query('DELETE FROM marketing_cash_observations WHERE id=$1', [first.id])).rejects.toThrow();
    // A newly committed eligible ledger row is missing capture even though all old members were delivered.
    await ledger("late_cash", "purchase", "pi_late");
    const second = await observation.createCashInventory(scoped, binding, scope, first.id);
    expect(second.document.B).toBe("incomplete");
    expect(second.document.predecessorDigest).toBe(first.digest);
    expect(second.document.gaps.some((g: {code: string}) => g.code === "missing_outbox")).toBe(true);
    expect((await observation.getCashObservation(scoped, first.id)).digest).toBe(first.digest);
    expect((await observation.getCashObservation(scoped, first.id)).document).toEqual(first.document);
    const before = await prisma.marketingConversion.findMany();
    const compared = await observation.compareCashInventory(scoped, binding, second.id, (async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.method === "GET") return Response.json({ schemaVersion: 1, sourceId: config.sourceId, environment: "test", keyId: receiptId, capabilities: binding.capabilities });
      const body = await request.json() as { entries: {eventType: string; transactionId: string}[] };
      return Response.json({ schemaVersion: 1, ...binding, observation: { startedAt: scope.to, completedAt: scope.to }, entries: body.entries.map(e => ({ eventType: e.eventType, transactionId: e.transactionId, status: "matched", receiptId, receivedAt: scope.to })) });
    }) as typeof fetch);
    expect(compared.document.A).toBe("declared_members_matched");
    expect(compared.document.B).toBe("incomplete");
    expect(compared.document.C).toBe("unknown");
    expect(await prisma.marketingConversion.findMany()).toEqual(before);
  });

  it("records a lost-ACK comparison without retrying or delivering the retained outbox row", async () => {
    const observation = await import("../marketing-cash-observation");
    const binding = { sourceId: config.sourceId, environment: "test" as const, keyId: receiptId, capabilities: ["purchases", "refunds"], project: { projectId: randomUUID(), version: 7 } };
    const scoped = { ...config, serverKey: `uads_${receiptId}_${"a".repeat(43)}` };
    await ledger("lost_ack", "purchase", "pi_fixture");
    await outbox.captureMarketingConversions(config);
    const claimed = (await outbox.claimMarketingConversion(config))!;
    let deliveries = 0;
    await outbox.processMarketingConversion(claimed, config, fixture().reader, withIdentity(async () => { deliveries++; throw new Error("synthetic lost acknowledgement"); }));
    const before = await prisma.marketingConversion.findUniqueOrThrow({ where: { id: claimed.id } });
    expect(before.status).toBe("pending"); expect(before.payload).not.toBeNull(); expect(before.receiptId).toBeNull();
    const scope = { from: config.from.toISOString(), to: new Date().toISOString() };
    const inventory = await observation.createCashInventory(scoped, binding, scope);
    const methods: string[] = [];
    const compared = await observation.compareCashInventory(scoped, binding, inventory.id, (async (input: RequestInfo | URL) => {
      const request = input as Request; methods.push(request.method);
      if (request.method === "GET") return Response.json({ schemaVersion: 1, sourceId: config.sourceId, environment: "test", keyId: receiptId, capabilities: binding.capabilities });
      const body = await request.json() as { entries: {eventType: string; transactionId: string}[] };
      return Response.json({ schemaVersion: 1, ...binding, observation: { startedAt: scope.to, completedAt: scope.to }, entries: body.entries.map(e => ({ eventType: e.eventType, transactionId: e.transactionId, status: "matched", receiptId, receivedAt: scope.to })) });
    }) as typeof fetch);
    expect(compared.document.A).toBe("declared_members_matched"); expect(compared.document.B).toBe("incomplete"); expect(compared.document.C).toBe("unknown");
    expect(methods).toEqual(["GET", "POST"]); expect(deliveries).toBe(1);
    expect(await prisma.marketingConversion.findUniqueOrThrow({ where: { id: claimed.id } })).toEqual(before);
    let calls = 0;
    await expect(observation.compareCashInventory(scoped, { ...binding, project: { ...binding.project, version: 8 } }, inventory.id, (async () => { calls++; throw new Error("must not send"); }) as typeof fetch)).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it("captures consented visits and immutable signup/payment associations without changing billing", async () => {
    const capture = await import("../marketing-capture");
    const { VISIT_COOKIE, ATTRIBUTION_COOKIE } = await import("../marketing-consent");
    const tracking: TrackingConfig = { ...config, trackingId: randomUUID(), projectId: randomUUID(), origin: "https://octopus-review.ai", trackingFrom: config.from };
    const env = { UNIFIED_ADS_ENABLED: "true", UNIFIED_ADS_SOURCE_ID: config.sourceId, UNIFIED_ADS_ENVIRONMENT: "test",
      UNIFIED_ADS_SERVER_KEY: `uads_${receiptId}_${"a".repeat(43)}`, UNIFIED_ADS_FROM: config.from.toISOString(), NODE_ENV: "test",
      OCTOPUS_SELF_HOSTED: "false", NEXT_PUBLIC_OCTOPUS_SELF_HOSTED: "false", UNIFIED_ADS_TRACKING_ENABLED: "true",
      UNIFIED_ADS_TRACKING_ID: tracking.trackingId, UNIFIED_ADS_PROJECT_ID: tracking.projectId, UNIFIED_ADS_TRACKING_ORIGIN: tracking.origin, UNIFIED_ADS_TRACKING_FROM: config.from.toISOString() };
    const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    try {
      Object.assign(process.env, env);
      const data = { analyticsConsent: true, attributionConsent: true, sessionId: randomUUID() };
      expect(await capture.captureMarketingVisit(tracking, { analyticsConsent: false, attributionConsent: false }, null)).toBeNull();
      expect(await prisma.marketingConversion.count()).toBe(0);
      const eventId = await capture.captureMarketingVisit(tracking, data, null);
      const cookie = `${VISIT_COOKIE}=${eventId}; ${ATTRIBUTION_COOKIE}=granted`;
      const original = (await capture.readMarketingVisit(tracking, cookie))!;
      expect(original.visit.attributionConsent).toBe(true);
      const next = await capture.captureMarketingVisit(tracking, { ...data, sessionId: randomUUID() }, cookie);
      const second = (await capture.readMarketingVisit(tracking, `${VISIT_COOKIE}=${next}`))!;
      expect(second.visit.visitorId).toBe(original.visit.visitorId);
      expect(second.visit.sessionId).not.toBe(original.visit.sessionId);
      expect(await capture.readMarketingVisit({ ...tracking, sourceId: randomUUID() }, cookie)).toBeNull();
      expect(await capture.readMarketingVisit({ ...tracking, environment: "live" }, cookie)).toBeNull();
      expect(await capture.signupMarketingVisit(`${VISIT_COOKIE}=${eventId}`)).toBeNull(); // withdrawn permission, stale response cookie
      expect(await capture.signupMarketingVisit(cookie)).toBe(original.id);
      const at = new Date();
      await db.query(`INSERT INTO users (id, "createdAt", "marketingVisitId") VALUES ($1, $2::timestamptz AT TIME ZONE 'UTC', $3)`, ["new_user", at.toISOString(), original.id]);
      await expect(db.query('UPDATE users SET "marketingVisitId" = NULL WHERE id = $1', ["new_user"])).rejects.toThrow();
      const f = fixture(); f.charge.created = Math.ceil(Date.now() / 1000) + 1;
      const attempt = await capture.beginMarketingPayment("org_fixture", "same-operation", cookie);
      expect(attempt).not.toBeNull();
      expect(await capture.beginMarketingPayment("org_fixture", "same-operation", null)).toBe(attempt);
      await capture.bindMarketingPayment(attempt, "pi_fixture", { lastResponse: { headers: {} } });
      await capture.bindMarketingPayment(attempt, "pi_different", { lastResponse: { headers: {} } });
      expect((await prisma.marketingPaymentAttribution.findUniqueOrThrow({ where: { id: attempt! } })).paymentReference).toBe("pi_fixture");
      await capture.captureMarketingContexts(tracking, f.reader);
      await capture.captureMarketingContexts(tracking, f.reader);
      const contexts = await prisma.marketingConversion.findMany({ where: { kind: "conversion_context" } });
      expect(contexts).toHaveLength(2);
      const parsed = contexts.map(row => JSON.parse(row.payload!));
      expect(parsed.find(d => d.conversionType === "registration")).toMatchObject({ conversionId: conversionId("user", "new_user"), occurredAt: at.toISOString(), visitorId: original.visit.visitorId });
      expect(parsed.find(d => d.conversionType === "purchase")).toMatchObject({ conversionId: conversionId("payment", "pi_fixture"), occurredAt: new Date(f.charge.created * 1000).toISOString(), visitorId: original.visit.visitorId });
      const unconsented = await capture.beginMarketingPayment("org_fixture", "no-consent-first", null);
      await capture.beginMarketingPayment("org_fixture", "no-consent-first", cookie);
      expect((await prisma.marketingPaymentAttribution.findUniqueOrThrow({ where: { id: unconsented! } })).visitorId).toBeNull();
      const replay = await capture.beginMarketingPayment("org_fixture", "ambiguous-response", cookie);
      await capture.bindMarketingPayment(replay, "pi_replay", { lastResponse: { headers: { "idempotent-replayed": "true" } } });
      expect((await prisma.marketingPaymentAttribution.findUniqueOrThrow({ where: { id: replay! } })).paymentReference).toBeNull();
      await expect(Promise.resolve(prisma.marketingPaymentAttribution.update({ where: { id: attempt! }, data: { visitorId: null } }))).rejects.toThrow();
      const before = await prisma.marketingConversion.count();
      await expect(capture.captureMarketingVisit(tracking, { ...data, campaignId: "browser-forged" }, cookie)).rejects.toThrow();
      await expect(capture.captureMarketingVisit(tracking, { ...data, attributionConsent: false, campaignLinkId: randomUUID() }, cookie)).rejects.toThrow();
      expect(await prisma.marketingConversion.count()).toBe(before);
      const rateLimit = await import("../rate-limit");
      const admission = spyOn(rateLimit, "fixedWindowLimit").mockResolvedValue({ ok: false, remaining: 0, retryAfterSeconds: 60 });
      try {
        const route = await import("../../app/api/marketing/visit/route");
        const request = (body: unknown, origin = tracking.origin) => new Request("http://0.0.0.0:3000/api/marketing/visit", {
          method: "POST", headers: { Host: new URL(tracking.origin).host, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        expect((await route.POST(request(data))).status).toBe(429);
        admission.mockResolvedValue({ ok: true, remaining: 1, retryAfterSeconds: 0 });
        expect((await route.POST(request(data, "https://foreign.invalid"))).status).toBe(403);
        expect((await route.POST(request({ ...data, extra: "x".repeat(600) }))).status).toBe(400);
        expect((await route.POST(request({ analyticsConsent: false, attributionConsent: false }))).status).toBe(204);
        const stalled = new Request(`${tracking.origin}/api/marketing/visit`, { method: "POST", headers: { Host: new URL(tracking.origin).host, Origin: tracking.origin, "Content-Type": "application/json" }, body: new ReadableStream() });
        expect((await route.POST(stalled)).status).toBe(400);
        for (const [header, value] of [["origin", null], ["host", null], ["host", "foreign.invalid"], ["host", "octopus-review.ai:3000"]] as const) {
          const invalid = request(data);
          if (value === null) invalid.headers.delete(header);
          else invalid.headers.set(header, value);
          invalid.headers.set("x-forwarded-host", new URL(tracking.origin).host);
          invalid.headers.set("x-forwarded-proto", "https");
          expect((await route.POST(invalid)).status).toBe(403);
        }
        const query = new Request(`${request(data).url}?source=other`, request(data));
        expect((await route.POST(query)).status).toBe(403);
        expect(await prisma.marketingConversion.count()).toBe(before);
        const proxied = request(data);
        // The public Host is authoritative; forwarded metadata may describe an internal hop.
        proxied.headers.set("x-forwarded-host", "internal.invalid");
        proxied.headers.set("x-forwarded-proto", "http");
        const accepted = await route.POST(proxied);
        expect(accepted.status).toBe(204);
        expect(accepted.headers.get("set-cookie")).toContain(`${VISIT_COOKIE}=`);
        expect(await prisma.marketingConversion.count()).toBe(before + 1);
      } finally { admission.mockRestore(); }
      const stripeModule = await import("../stripe");
      const previousStripeKey = process.env.STRIPE_SECRET_KEY;
      process.env.STRIPE_SECRET_KEY = "sk_test_synthetic_local_fixture";
      const sdk = stripeModule.getStripe();
      await db.query('INSERT INTO organizations (id, "stripeCustomerId", name, slug) VALUES ($1,$2,$3,$4)', ["org_fixture", "cus_fixture", "Synthetic test organization", "synthetic-fixture"]);
      const customer = spyOn(sdk.customers, "retrieve").mockResolvedValue({ id: "cus_fixture", deleted: false } as never);
      const checkout = spyOn(sdk.checkout.sessions, "create").mockImplementation(async params => {
        expect(params.metadata?.orgId).toBe("org_fixture");
        expect(params.metadata).not.toHaveProperty("visitorId");
        expect(await prisma.marketingPaymentAttribution.count({ where: { organizationId: "org_fixture", paymentReference: null, visitorId: original.visit.visitorId } })).toBeGreaterThan(0);
        return { id: "cs_hosted_proof", url: "https://checkout.stripe.com/synthetic", lastResponse: { headers: {} } } as never;
      });
      try {
        expect(await stripeModule.createCheckoutSession("org_fixture", 10, "https://octopus-review.ai/settings/billing", cookie)).toBe("https://checkout.stripe.com/synthetic");
        const hosted = await prisma.marketingPaymentAttribution.findFirstOrThrow({ where: { paymentReference: "cs_hosted_proof" } });
        expect(hosted.visitorId).toBe(original.visit.visitorId);
        expect(checkout).toHaveBeenCalledTimes(1);
        const hostedPayment = fixture();
        hostedPayment.payment.id = "pi_hosted_proof";
        hostedPayment.payment.metadata = {};
        hostedPayment.checkout.id = "cs_hosted_proof";
        hostedPayment.checkout.status = "open";
        hostedPayment.checkout.payment_status = "unpaid";
        hostedPayment.checkout.payment_intent = null;
        hostedPayment.charge.payment_intent = hostedPayment.payment.id;
        hostedPayment.charge.created = Math.ceil(Date.now() / 1000) + 1;
        await capture.captureMarketingContexts(tracking, hostedPayment.reader);
        const pending = await prisma.marketingPaymentAttribution.findUniqueOrThrow({ where: { id: hosted.id } });
        expect(pending.completedAt).toBeNull();
        expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
        expect(await prisma.marketingConversion.count({ where: { kind: "conversion_context" } })).toBe(2);
        hostedPayment.checkout.status = "complete";
        hostedPayment.checkout.payment_status = "paid";
        hostedPayment.checkout.payment_intent = hostedPayment.payment.id;
        await prisma.marketingPaymentAttribution.update({ where: { id: hosted.id }, data: { nextAttemptAt: new Date(0) } });
        await capture.captureMarketingContexts(tracking, hostedPayment.reader);
        await capture.captureMarketingContexts(tracking, hostedPayment.reader);
        expect((await prisma.marketingPaymentAttribution.findUniqueOrThrow({ where: { id: hosted.id } })).completedAt).not.toBeNull();
        const completedContexts = await prisma.marketingConversion.findMany({ where: { kind: "conversion_context" } });
        expect(completedContexts).toHaveLength(3);
        expect(completedContexts.map(row => JSON.parse(row.payload!)).find(record => record.conversionId === conversionId("payment", hostedPayment.payment.id)))
          .toMatchObject({ conversionType: "purchase", visitorId: original.visit.visitorId, occurredAt: new Date(hostedPayment.charge.created * 1000).toISOString() });
      } finally { checkout.mockRestore(); customer.mockRestore(); if (previousStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = previousStripeKey; }
    } finally {
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });

  it("persists tracking bytes in the same outbox, recovers a lost response, and fences foreign bindings", async () => {
    const tracking: TrackingConfig = { ...config, trackingId: randomUUID(), projectId: randomUUID(), origin: "https://octopus-review.ai", trackingFrom: config.from };
    const body = JSON.stringify({ schemaVersion: 1, recordType: "visit", eventId: randomUUID(), trackingId: tracking.trackingId,
      occurredAt: new Date().toISOString(), visitorId: trackingIdentity("visitor", config.sourceId, randomUUID()),
      sessionId: trackingIdentity("session", config.sourceId, randomUUID()), origin: tracking.origin,
      analyticsConsent: "granted", attributionConsent: false, campaignLinkId: null });
    const id = await outbox.enqueueMarketingTracking(tracking, body);
    expect(await outbox.enqueueMarketingTracking(tracking, body)).toBe(id);
    await expect(outbox.enqueueMarketingTracking(tracking, body.replace('"attributionConsent":false', '"attributionConsent":true'))).rejects.toThrow("tracking_identity_conflict");
    await expect(Promise.resolve(prisma.marketingConversion.update({ where: { id }, data: { payload: "{}" } }))).rejects.toThrow();
    const identities: string[] = []; const bodies: string[] = [];
    const send = async (request: Request) => {
      identities.push(request.method);
      if (request.method === "GET") return Response.json({ schemaVersion: 1, sourceId: tracking.sourceId,
        environment: tracking.environment, keyId: receiptId, trackingId: tracking.trackingId,
        projectId: tracking.projectId, origin: tracking.origin, model: TRACKING_MODEL, recordTypes: ["visit", "conversion_context"] });
      bodies.push(await request.text());
      if (bodies.length === 1) throw new Error("lost successful response");
      return Response.json({ receiptId, duplicate: true, status: "stored", sourceId: tracking.sourceId, environment: tracking.environment, trackingId: tracking.trackingId });
    };
    let row = (await outbox.claimMarketingConversion(config, new Date(), true))!;
    expect(await outbox.processMarketingConversion(row, config, undefined, send, tracking)).toBe("retry");
    await due(id);
    row = (await outbox.claimMarketingConversion(config, new Date(), true))!;
    expect(await outbox.processMarketingConversion(row, config, undefined, send, tracking)).toBe("delivered");
    expect(bodies).toEqual([body, body]);
    expect(identities).toEqual(["GET", "POST", "GET", "POST"]);
    expect(await prisma.marketingConversion.findUniqueOrThrow({ where: { id } })).toMatchObject({ payload: body, receiptId, attempts: 2, status: "delivered" });
    const second = await outbox.enqueueMarketingTracking(tracking, body.replace(JSON.parse(body).eventId, randomUUID()));
    row = (await outbox.claimMarketingConversion(config, new Date(), true))!;
    expect(row.id).toBe(second);
    expect(await outbox.processMarketingConversion(row, config, undefined, send, { ...tracking, trackingId: randomUUID() })).toBe("blocked");
    expect(identities).toHaveLength(4);
  });

  for (const activation of ["false", "true"]) {
    it(`preserves an older tracking backlog without consuming business capacity with tracking ${activation}`, async () => {
      const tracking: TrackingConfig = { ...config, trackingId: randomUUID(), projectId: randomUUID(), origin: "https://octopus-review.ai", trackingFrom: config.from };
      for (let index = 0; index < 25; index++) {
        const common = { schemaVersion: 1, eventId: randomUUID(), trackingId: tracking.trackingId,
          occurredAt: new Date().toISOString(), visitorId: trackingIdentity("visitor", config.sourceId, randomUUID()) };
        const record = index % 2 === 0
          ? { ...common, recordType: "conversion_context", conversionType: "registration", conversionId: conversionId("user", "test_user"), attributionConsent: "granted" }
          : { ...common, recordType: "visit", sessionId: trackingIdentity("session", config.sourceId, randomUUID()), origin: tracking.origin,
            analyticsConsent: "granted", attributionConsent: false, campaignLinkId: null };
        await due(await outbox.enqueueMarketingTracking(tracking, JSON.stringify(record, null, 2)));
      }
      const before = await prisma.marketingConversion.findMany({ orderBy: { id: "asc" } });
      await user();
      const env = {
        UNIFIED_ADS_ENABLED: "true", UNIFIED_ADS_SOURCE_ID: config.sourceId,
        UNIFIED_ADS_ENVIRONMENT: "test", UNIFIED_ADS_SERVER_KEY: `uads_${receiptId}_${"a".repeat(43)}`,
        UNIFIED_ADS_FROM: config.from.toISOString(), NODE_ENV: "test",
        OCTOPUS_SELF_HOSTED: "false", NEXT_PUBLIC_OCTOPUS_SELF_HOSTED: "false",
        UNIFIED_ADS_TRACKING_ENABLED: activation, UNIFIED_ADS_TRACKING_ID: "invalid",
      };
      const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
      const bodies: string[] = [];
      const send = spyOn(globalThis, "fetch").mockImplementation(withIdentity(async request => {
        bodies.push(await request.text());
        return received();
      }) as typeof fetch);
      try {
        Object.assign(process.env, env);
        await outbox.syncMarketingConversions();
        expect(bodies.map(body => JSON.parse(body).eventType)).toEqual(["registration"]);
        expect(await prisma.marketingConversion.findMany({ where: { kind: { in: ["visit", "conversion_context"] } }, orderBy: { id: "asc" } })).toEqual(before);
        expect(await prisma.marketingConversion.findFirstOrThrow({ where: { kind: "registration" } }))
          .toMatchObject({ status: "delivered", attempts: 1, receiptId });
        expect(await outbox.claimMarketingConversion(config)).toBeNull();
        const resumed = (await outbox.claimMarketingConversion(config, new Date(), true))!;
        expect(resumed.payload).toBe(before.find(row => row.id === resumed.id)!.payload);
        expect(resumed.attempts).toBe(1);
      } finally {
        send.mockRestore();
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });
  }

  it("delivers a later purchase before an older backlog with a valid but wrong tracking project", async () => {
    const tracking: TrackingConfig = { ...config, trackingId: randomUUID(), projectId: randomUUID(), origin: "https://octopus-review.ai", trackingFrom: config.from };
    for (let index = 0; index < 25; index++) {
      const body = JSON.stringify({ schemaVersion: 1, recordType: "visit", eventId: randomUUID(), trackingId: tracking.trackingId,
        occurredAt: new Date().toISOString(), visitorId: trackingIdentity("visitor", config.sourceId, randomUUID()),
        sessionId: trackingIdentity("session", config.sourceId, randomUUID()), origin: tracking.origin,
        analyticsConsent: "granted", attributionConsent: false, campaignLinkId: null }, null, 2);
      await due(await outbox.enqueueMarketingTracking(tracking, body));
    }
    const before = await prisma.marketingConversion.findMany({ orderBy: { id: "asc" } });
    await ledger("payment", "purchase", "pi_fixture");
    await outbox.captureMarketingConversions(config);
    const payment = (await outbox.claimMarketingConversion(config))!;
    expect(await outbox.processMarketingConversion(payment, config, fixture().reader, withIdentity(async () => {
      throw new Error("receipt lost");
    }))).toBe("retry");
    await prisma.marketingConversion.update({ where: { id: payment.id }, data: { nextAttemptAt: new Date(1000) } });
    const persisted = (await prisma.marketingConversion.findUniqueOrThrow({ where: { id: payment.id } })).payload;
    const env = {
      UNIFIED_ADS_ENABLED: "true", UNIFIED_ADS_SOURCE_ID: config.sourceId,
      UNIFIED_ADS_ENVIRONMENT: "test", UNIFIED_ADS_SERVER_KEY: `uads_${receiptId}_${"a".repeat(43)}`,
      UNIFIED_ADS_FROM: config.from.toISOString(), NODE_ENV: "test",
      OCTOPUS_SELF_HOSTED: "false", NEXT_PUBLIC_OCTOPUS_SELF_HOSTED: "false",
      UNIFIED_ADS_TRACKING_ENABLED: "true", UNIFIED_ADS_TRACKING_ID: tracking.trackingId,
      UNIFIED_ADS_PROJECT_ID: randomUUID(), UNIFIED_ADS_TRACKING_ORIGIN: tracking.origin,
      UNIFIED_ADS_TRACKING_FROM: tracking.trackingFrom.toISOString(),
    };
    const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    const bodies: string[] = [];
    let trackingAttempts = 0;
    const businessSend = withIdentity(async request => {
      bodies.push(await request.text());
      return received(true);
    });
    const send = spyOn(globalThis, "fetch").mockImplementation((async (request: Request) => {
      if (!new URL(request.url).pathname.startsWith("/api/conversion-tracking")) return businessSend(request);
      expect(request.method).toBe("GET");
      expect(bodies).toEqual([persisted]);
      expect(await prisma.marketingConversion.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "delivered" });
      trackingAttempts++;
      return Response.json({ schemaVersion: 1, sourceId: config.sourceId, environment: config.environment, keyId: receiptId,
        trackingId: tracking.trackingId, projectId: tracking.projectId, origin: tracking.origin,
        model: TRACKING_MODEL, recordTypes: ["visit", "conversion_context"] });
    }) as typeof fetch);
    try {
      Object.assign(process.env, env);
      await outbox.syncMarketingConversions();
      expect(bodies).toEqual([persisted]);
      expect(JSON.parse(bodies[0]!).eventType).toBe("purchase");
      expect(trackingAttempts).toBe(19);
      const after = await prisma.marketingConversion.findMany({ where: { kind: "visit" }, orderBy: { id: "asc" } });
      expect(after.map(row => ({ id: row.id, payload: row.payload, status: row.status })))
        .toEqual(before.map(row => ({ id: row.id, payload: row.payload, status: row.status })));
      expect(after.filter(row => row.attempts === 1)).toHaveLength(19);
      expect(after.filter(row => row.attempts === 0)).toHaveLength(6);
    } finally {
      send.mockRestore();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("captures actual registrations and Stripe-linked cash facts, including usage-typed refunds", async () => {
    await user();
    await user("pre_cutoff", new Date("2026-09-08T00:00:00Z"));
    await ledger("payment", "purchase", "pi_fixture");
    await ledger("auto_reload", "auto_reload", "pi_other");
    await ledger("refund", "usage", null, "re_fixture");
    await ledger("ordinary_usage", "usage", null);
    await ledger("promotional_credit", "purchase", null);
    const captures = await Promise.all([outbox.captureMarketingConversions(config), outbox.captureMarketingConversions(config)]);
    expect(captures[0]! + captures[1]!).toBe(4);
    const rows = await prisma.marketingConversion.findMany();
    expect(rows.filter(row => row.kind === "refund")).toHaveLength(1);
    expect(rows.find(row => row.kind === "registration")?.payload).toContain(conversionId("user", "test_user"));
    expect(await outbox.captureMarketingConversions(config)).toBe(0);
  });

  it("delivers registrations and replays persisted cash without Stripe credentials in the scheduled worker", async () => {
    const env = {
      UNIFIED_ADS_ENABLED: "true", UNIFIED_ADS_SOURCE_ID: config.sourceId,
      UNIFIED_ADS_ENVIRONMENT: "test", UNIFIED_ADS_SERVER_KEY: `uads_${receiptId}_${"a".repeat(43)}`,
      UNIFIED_ADS_FROM: config.from.toISOString(), NODE_ENV: "test",
      OCTOPUS_SELF_HOSTED: "false", NEXT_PUBLIC_OCTOPUS_SELF_HOSTED: "false",
      STRIPE_SECRET_KEY: undefined,
    };
    const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    const bodies: string[] = [];
    const send = spyOn(globalThis, "fetch").mockImplementation(withIdentity(async request => {
      bodies.push(await request.text());
      return received(true);
    }) as typeof fetch);
    try {
      for (const [key, value] of Object.entries(env)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await ledger("payment", "subscription", "pi_fixture");
      await outbox.captureMarketingConversions(config);
      const payment = (await outbox.claimMarketingConversion(config))!;
      expect(await outbox.processMarketingConversion(payment, config, fixture().reader, withIdentity(async () => {
        throw new Error("receipt lost");
      }))).toBe("retry");
      const persisted = (await prisma.marketingConversion.findUniqueOrThrow({ where: { id: payment.id } })).payload!;
      await due(payment.id);
      await user();
      // An unresolved cash row must retry without starving independent delivery.
      await ledger("unresolved", "purchase", "pi_unresolved");
      await outbox.syncMarketingConversions();
      const rows = await prisma.marketingConversion.findMany();
      expect(rows.find(row => row.kind === "registration")).toMatchObject({ status: "delivered", receiptId, attempts: 1 });
      expect(rows.find(row => row.id === payment.id)).toMatchObject({ status: "delivered", receiptId, attempts: 2, payload: persisted });
      expect(rows.find(row => row.reference === "pi_unresolved")).toMatchObject({ status: "pending", errorCode: "source_unavailable", receiptId: null, payload: null });
      expect(bodies).toHaveLength(2);
      expect(bodies).toContain(persisted);
      expect(bodies.map(body => JSON.parse(body).eventType).sort()).toEqual(["purchase", "registration"]);
    } finally {
      send.mockRestore();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("finds a transaction that commits after a sweep with an older timestamp", async () => {
    const late = new Client({ connectionString: testUrl });
    await late.connect();
    try {
      await late.query("BEGIN");
      await late.query('INSERT INTO users VALUES ($1, $2)', ["late_commit", config.from]);
      expect(await outbox.captureMarketingConversions(config)).toBe(0);
      await user("newer_commit");
      expect(await outbox.captureMarketingConversions(config)).toBe(1);
      await late.query("COMMIT");
      expect(await outbox.captureMarketingConversions(config)).toBe(1);
    } finally {
      await late.query("ROLLBACK");
      await late.end();
    }
  });

  it("claims each row once concurrently and fences an expired worker", async () => {
    await user(); await outbox.captureMarketingConversions(config);
    const claims = await Promise.all(Array.from({ length: 6 }, () => outbox.claimMarketingConversion(config)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    const first = claims.find(row => row !== null)!;
    await prisma.marketingConversion.update({ where: { id: first.id }, data: { leaseUntil: new Date(0) } });
    const successor = (await outbox.claimMarketingConversion(config))!;
    expect(successor.leaseId).not.toBe(first.leaseId);
    expect(await outbox.finishMarketingConversion(first, { kind: "delivered", status: 201, receiptId })).toBe(false);
    expect(await outbox.processMarketingConversion(first, config, fixture().reader, async () => { throw new Error("stale send"); })).toBe("lease_lost");
    expect(await outbox.processMarketingConversion(successor, config, fixture().reader, withIdentity(async () => received()))).toBe("delivered");
  });

  it("persists exact bytes before HTTP, retries an uncertain acceptance and survives key rotation", async () => {
    await ledger("payment", "subscription", "pi_fixture");
    await outbox.captureMarketingConversions(config);
    const first = (await outbox.claimMarketingConversion(config))!;
    let firstBody = "";
    const reader = fixture().reader;
    expect(await outbox.processMarketingConversion(first, config, reader, withIdentity(async (request) => {
      firstBody = await request.text();
      expect((await prisma.marketingConversion.findUniqueOrThrow({ where: { id: first.id } })).payload).toBe(firstBody);
      throw new Error("response lost after receiver commit");
    }))).toBe("retry");
    await due(first.id);
    const retry = (await outbox.claimMarketingConversion(config))!;
    reader.payment = async () => { throw new Error("must not reconstruct accepted payment"); };
    expect(await outbox.processMarketingConversion(retry, { ...config, serverKey: "rotated-test-key" }, reader, withIdentity(async request => {
      expect(await request.text()).toBe(firstBody);
      expect(request.headers.get("authorization")).toBe("Bearer rotated-test-key");
      return received(true);
    }))).toBe("delivered");
    expect(await prisma.marketingConversion.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ receiptId, status: "delivered", attempts: 2, payload: firstBody });
  });

  it("keeps an old original payment as a refund dependency and deduplicates CS/PI aliases", async () => {
    await ledger("refund", "usage", null, "re_fixture");
    await ledger("cs_purchase", "subscription", "cs_fixture");
    await ledger("pi_purchase", "subscription", "pi_fixture");
    await outbox.captureMarketingConversions(config);
    const f = fixture(); f.payment.metadata = {};
    const refund = await prisma.marketingConversion.findFirstOrThrow({ where: { kind: "refund" } });
    await due(refund.id); // Exercise the missing-original dependency before the ledger aliases deliver.
    const bodies = new Map<string, string>();
    for (let index = 0; index < 4; index++) {
      const row = (await outbox.claimMarketingConversion(config))!;
      expect(row).not.toBeNull();
      expect(await outbox.processMarketingConversion(row, config, f.reader, withIdentity(async request => {
        const body = await request.text(); const event = JSON.parse(body);
        const previous = bodies.get(event.eventId);
        if (previous) expect(body).toBe(previous);
        bodies.set(event.eventId, body);
        return received(Boolean(previous));
      }))).toBe("delivered");
    }
    expect(bodies.size).toBe(2);
    expect(await prisma.marketingConversion.count({ where: { status: "delivered" } })).toBe(4);

    const purchases = await prisma.marketingConversion.findMany({ where: { kind: "purchase" }, orderBy: { id: "asc" } });
    expect(purchases).toHaveLength(3);
    expect(purchases.map(row => row.httpStatus).sort()).toEqual([200, 200, 201]);
    f.refund.id = "pyr_later"; f.refund.amount = 100;
    await ledger("later_refund", "usage", null, f.refund.id);
    await outbox.captureMarketingConversions(config);
    const later = (await outbox.claimMarketingConversion(config))!;
    const sends: string[] = [];
    const send = withIdentity(async (request: Request) => { sends.push(await request.text()); return received(); });
    expect(await outbox.processMarketingConversion(later, config, f.reader, send)).toBe("delivered");

    f.refund.id = "pyr_blocked";
    await ledger("blocked_refund", "usage", null, f.refund.id);
    await outbox.captureMarketingConversions(config);
    const blocked = (await outbox.claimMarketingConversion(config))!;
    await outbox.finishMarketingConversion(blocked, { kind: "blocked", code: "unsupported_refund_reference" });
    const before = await prisma.marketingConversion.findMany({ orderBy: { id: "asc" } });
    const ledgerBefore = (await db.query('SELECT * FROM credit_transactions ORDER BY id')).rows;
    const retry = await import("../marketing-refund-retry");
    const preview = await retry.previewMarketingRefundRetry(blocked.id, config, f.reader);
    expect(preview.originalPurchase).toMatchObject({ outboxId: purchases[0]!.id, receiptId });
    expect(await retry.previewMarketingRefundRetry(blocked.id, config, f.reader)).toEqual(preview);
    expect(await prisma.marketingConversion.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    const results = await Promise.allSettled([1, 2].map(() => retry.retryMarketingRefund(blocked.id, preview.previewHash, config, f.reader)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    await expect(retry.retryMarketingRefund(blocked.id, preview.previewHash, config, f.reader)).rejects.toThrow("refund_retry_ineligible");
    const recovered = (await outbox.claimMarketingConversion(config))!;
    expect(recovered.id).toBe(blocked.id);
    expect(await outbox.processMarketingConversion(recovered, config, f.reader, send)).toBe("delivered");
    expect(sends.map(body => JSON.parse(body))).toEqual([
      expect.objectContaining({ eventType: "refund", amountMinor: "100", transactionId: conversionId("refund", "pyr_later") }),
      preview.event,
    ]);
    expect(await outbox.claimMarketingConversion(config)).toBeNull();
    expect(await prisma.marketingConversion.count()).toBe(before.length);
    expect(await prisma.marketingConversion.findMany({ where: { kind: "purchase" }, orderBy: { id: "asc" } })).toEqual(purchases);
    expect((await db.query('SELECT * FROM credit_transactions ORDER BY id')).rows).toEqual(ledgerBefore);
  });

  it("holds a conflicting receipt and retries auth/rate-limit failures without changing identity", async () => {
    await user(); await outbox.captureMarketingConversions(config);
    for (const status of [401, 429, 409]) {
      const row = (await outbox.claimMarketingConversion(config))!;
      const result = await outbox.processMarketingConversion(row, config, fixture().reader, withIdentity(async () => new Response("untrusted receiver detail", { status })));
      expect(result).toBe(status === 409 ? "blocked" : "retry");
      const saved = await prisma.marketingConversion.findUniqueOrThrow({ where: { id: row.id } });
      expect(saved.receiptId).toBeNull();
      expect(saved.payload).toBe(row.payload);
      expect(saved.errorCode).not.toContain("untrusted");
      await due(row.id);
    }
    expect(await outbox.claimMarketingConversion(config)).toBeNull();
  });

  it("separates TEST/LIVE sources and refuses a source identity reused for a different environment", async () => {
    await user(); await outbox.captureMarketingConversions(config);
    const live = { ...config, sourceId: randomUUID(), environment: "live" as const };
    expect(await outbox.claimMarketingConversion(live)).toBeNull();
    expect(await outbox.captureMarketingConversions(live)).toBe(1);
    const row = (await outbox.claimMarketingConversion(config))!;
    await expect(outbox.processMarketingConversion(row, live, fixture().reader)).rejects.toMatchObject({ code: "outbox_source_mismatch" });
    await expect(outbox.captureMarketingConversions({ ...config, environment: "live" })).rejects.toMatchObject({ code: "source_environment_mismatch" });
  });

  it("keeps persisted events pending without POST or acknowledgement when receiver identity is rejected", async () => {
    await user(); await outbox.captureMarketingConversions(config);
    for (const identity of [
      { schemaVersion: 1, sourceId: randomUUID(), environment: "test", keyId: receiptId, capabilities: ["registrations", "purchases", "refunds"] },
      { schemaVersion: 1, sourceId: config.sourceId, environment: "live", keyId: receiptId, capabilities: ["registrations", "purchases", "refunds"] },
      null,
    ]) {
      const row = (await outbox.claimMarketingConversion(config))!;
      const methods: string[] = [];
      expect(await outbox.processMarketingConversion(row, config, fixture().reader, async request => {
        methods.push(request.method);
        return identity ? Response.json(identity) : new Response(null, { status: 401 });
      })).toBe("retry");
      expect(methods).toEqual(["GET"]);
      const saved = await prisma.marketingConversion.findUniqueOrThrow({ where: { id: row.id } });
      expect(saved.status).toBe("pending");
      expect(saved.receiptId).toBeNull();
      expect(saved.deliveredAt).toBeNull();
      expect(saved.payload).toBe(row.payload);
      expect(saved.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
      await due(row.id);
    }
  });

  it("enforces immutable request bytes/identity and valid lease/receipt state in PostgreSQL", async () => {
    await user(); await outbox.captureMarketingConversions(config);
    const row = (await prisma.marketingConversion.findFirstOrThrow());
    for (const data of [{ payload: "changed" }, { reference: "other_user" }, { sourceId: randomUUID() }, { leaseId: "half-lease" }, { status: "delivered" }]) {
      await expect(Promise.resolve(prisma.marketingConversion.update({ where: { id: row.id }, data }))).rejects.toThrow();
    }
    expect((await prisma.marketingConversion.findUniqueOrThrow({ where: { id: row.id } })).payload).toBe(row.payload);
  });

  async function blockedRefund() {
    const f = fixture();
    f.refund.id = "pyr_fixture"; f.refund.amount = 100;
    f.charge.id = "py_fixture"; f.payment.latest_charge = f.charge.id; f.refund.charge = f.charge.id;
    await ledger("original", "purchase", f.payment.id);
    await outbox.captureMarketingConversions(config);
    const original = (await outbox.claimMarketingConversion(config))!;
    expect(await outbox.processMarketingConversion(original, config, f.reader, withIdentity(async () => received()))).toBe("delivered");
    await ledger("refund", "usage", null, f.refund.id);
    await outbox.captureMarketingConversions(config);
    const refund = (await outbox.claimMarketingConversion(config))!;
    await outbox.finishMarketingConversion(refund, { kind: "blocked", code: "unsupported_refund_reference" });
    return { f, original, refund, retry: await import("../marketing-refund-retry") };
  }

  it("previews without writes and recovers one existing refund without purchase/context replay", async () => {
    const { f, original, refund, retry } = await blockedRefund();
    const before = await prisma.marketingConversion.findMany({ orderBy: { id: "asc" } });
    const ledgerBefore = (await db.query('SELECT * FROM credit_transactions ORDER BY id')).rows;
    const preview = await retry.previewMarketingRefundRetry(refund.id, config, f.reader);
    expect(preview.event).toMatchObject({ eventType: "refund", amountMinor: "100", currency: "USD", transactionId: conversionId("refund", f.refund.id), originalTransactionId: conversionId("payment", f.payment.id) });
    expect(preview.originalPurchase).toMatchObject({ outboxId: original.id, receiptId });
    expect(await prisma.marketingConversion.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    await expect(retry.retryMarketingRefund(refund.id, "0".repeat(64), config, f.reader)).rejects.toThrow("refund_retry_preview_changed");
    const results = await Promise.allSettled([1, 2].map(() => retry.retryMarketingRefund(refund.id, preview.previewHash, config, f.reader)));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const pending = await prisma.marketingConversion.findUniqueOrThrow({ where: { id: refund.id } });
    expect(pending).toMatchObject({ status: "pending", attempts: 1, payload: JSON.stringify(preview.event), reference: f.refund.id, receiptId: null });
    await expect(retry.retryMarketingRefund(refund.id, preview.previewHash, config, f.reader)).rejects.toThrow("refund_retry_ineligible");
    const sends: string[] = [];
    const claimed = (await outbox.claimMarketingConversion(config))!;
    f.reader.refund = async () => { throw new Error("persisted recovery must not reconstruct"); };
    expect(await outbox.processMarketingConversion(claimed, config, f.reader, withIdentity(async request => { sends.push(await request.text()); return received(); }))).toBe("delivered");
    expect(sends).toEqual([JSON.stringify(preview.event)]);
    expect(await outbox.claimMarketingConversion(config)).toBeNull();
    expect(await prisma.marketingConversion.count()).toBe(2);
    expect(await prisma.marketingConversion.findUniqueOrThrow({ where: { id: original.id } })).toEqual(before.find(row => row.id === original.id)!);
    expect((await db.query('SELECT * FROM credit_transactions ORDER BY id')).rows).toEqual(ledgerBefore);
  });

  it("reuses a delivered ledger-origin purchase in the ordinary refund worker", async () => {
    const { f, original } = await blockedRefund();
    await ledger("second_refund", "usage", null, "pyr_second");
    f.refund.id = "pyr_second";
    await outbox.captureMarketingConversions(config);
    const before = await prisma.marketingConversion.findUniqueOrThrow({ where: { id: original.id } });
    const row = (await outbox.claimMarketingConversion(config))!;
    expect(await outbox.processMarketingConversion(row, config, f.reader, withIdentity(async request => {
      expect(JSON.parse(await request.text()).eventType).toBe("refund"); return received();
    }))).toBe("delivered");
    expect(await prisma.marketingConversion.count({ where: { kind: "purchase" } })).toBe(1);
    expect(await prisma.marketingConversion.findUniqueOrThrow({ where: { id: original.id } })).toEqual(before);
  });

  it("rejects every conflicting delivered alias in preview, retry and ordinary delivery", async () => {
    const { f, original, refund, retry } = await blockedRefund();
    const purchase = await prisma.marketingConversion.findUniqueOrThrow({ where: { id: original.id } });
    await prisma.marketingConversion.create({ data: { ...purchase, id: "zz_equivalent", originKey: `payment:${f.payment.id}`, httpStatus: 200 } });
    const preview = await retry.previewMarketingRefundRetry(refund.id, config, f.reader);
    const conflicts = [
      { payload: JSON.stringify({ ...JSON.parse(purchase.payload!), amountMinor: "1" }) },
      { environment: "live" }, { organizationId: "foreign_org" },
      { receiptId: randomUUID() }, { receiptId: "invalid" }, { httpStatus: 202 },
    ];
    const ledgerBefore = (await db.query('SELECT * FROM credit_transactions ORDER BY id')).rows;
    for (const [index, conflict] of conflicts.entries()) {
      const alias = await prisma.marketingConversion.create({ data: { ...purchase, id: "zzz_conflict", originKey: "ledger:conflict", ...conflict } });
      const before = await prisma.marketingConversion.findMany({ orderBy: { id: "asc" } });
      await expect(retry.previewMarketingRefundRetry(refund.id, config, f.reader)).rejects.toThrow("original_payment_conflict");
      await expect(retry.retryMarketingRefund(refund.id, preview.previewHash, config, f.reader)).rejects.toThrow("original_payment_conflict");
      expect(await prisma.marketingConversion.findMany({ orderBy: { id: "asc" } })).toEqual(before);
      const next = await prisma.marketingConversion.create({ data: {
        sourceId: config.sourceId, environment: config.environment, kind: "refund", organizationId: purchase.organizationId,
        originKey: `ledger:later_${index}`, reference: f.refund.id, sourceCreatedAt: new Date(),
      } });
      const claimed = (await outbox.claimMarketingConversion(config))!;
      expect(claimed.id).toBe(next.id);
      const send = mock(async () => received());
      expect(await outbox.processMarketingConversion(claimed, config, f.reader, send)).toBe("blocked");
      expect(send).not.toHaveBeenCalled();
      expect(await prisma.marketingConversion.findUniqueOrThrow({ where: { id: next.id } })).toMatchObject({ errorCode: "original_payment_conflict", payload: null });
      await prisma.marketingConversion.deleteMany({ where: { id: { in: [alias.id, next.id] } } });
    }
    expect((await db.query('SELECT * FROM credit_transactions ORDER BY id')).rows).toEqual(ledgerBefore);
  });

  it("rejects delivered alias overflow instead of ignoring further candidates", async () => {
    const { f, original, refund, retry } = await blockedRefund();
    const purchase = await prisma.marketingConversion.findUniqueOrThrow({ where: { id: original.id } });
    await prisma.marketingConversion.createMany({ data: Array.from({ length: 99 }, (_, index) => ({
      ...purchase, id: `zz_alias_${index}`, originKey: `ledger:alias_${index}`, httpStatus: 200,
    })) });
    const preview = await retry.previewMarketingRefundRetry(refund.id, config, f.reader);
    await prisma.marketingConversion.create({ data: { ...purchase, id: "zzz_overflow", originKey: "ledger:overflow", httpStatus: 200 } });
    const before = await prisma.marketingConversion.findMany({ orderBy: { id: "asc" } });
    await expect(retry.previewMarketingRefundRetry(refund.id, config, f.reader)).rejects.toThrow("original_payment_conflict");
    await expect(retry.retryMarketingRefund(refund.id, preview.previewHash, config, f.reader)).rejects.toThrow("original_payment_conflict");
    expect(await prisma.marketingConversion.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });

  it("rejects changed facts, stale state, foreign binding and missing original delivery", async () => {
    const { f, original, refund, retry } = await blockedRefund();
    const preview = await retry.previewMarketingRefundRetry(refund.id, config, f.reader);
    for (const changed of [{ ...config, sourceId: randomUUID() }, { ...config, environment: "live" as const }, { ...config, from: new Date("2100-01-01") }]) {
      await expect(retry.previewMarketingRefundRetry(refund.id, changed, f.reader)).rejects.toThrow("refund_retry_ineligible");
    }
    await expect(retry.retryMarketingRefund(refund.id, preview.previewHash, { ...config, serverKey: "changed" }, f.reader)).rejects.toThrow("refund_retry_preview_changed");
    f.refund.amount = 101;
    await expect(retry.retryMarketingRefund(refund.id, preview.previewHash, config, f.reader)).rejects.toThrow("refund_retry_preview_changed");
    f.refund.amount = 100; f.refund.status = "pending";
    await expect(retry.previewMarketingRefundRetry(refund.id, config, f.reader)).rejects.toThrow("refund_not_succeeded");
    f.refund.status = "succeeded";
    await prisma.marketingConversion.update({ where: { id: refund.id }, data: { attempts: 2 } });
    await expect(retry.retryMarketingRefund(refund.id, preview.previewHash, config, f.reader)).rejects.toThrow("refund_retry_preview_changed");
    await prisma.marketingConversion.update({ where: { id: original.id }, data: { status: "pending" } });
    await expect(retry.previewMarketingRefundRetry(refund.id, config, f.reader)).rejects.toThrow("original_purchase_not_delivered");
    expect((await prisma.marketingConversion.findUniqueOrThrow({ where: { id: refund.id } })).payload).toBeNull();
    expect(await prisma.marketingConversion.count()).toBe(2);
  });

  it("rejects ineligible or ambiguous recovery rows before provider reads without writes", async () => {
    const { f, refund, retry } = await blockedRefund();
    const blocked = await prisma.marketingConversion.findUniqueOrThrow({ where: { id: refund.id } });
    const read = mock(f.reader.refund);
    f.reader.refund = read;
    const cases = [
      { sourceId: randomUUID() }, { environment: "live" }, { kind: "purchase" },
      { organizationId: null }, { originKey: "payment:ineligible" },
      { sourceCreatedAt: new Date(config.from.getTime() - 1) },
      { status: "pending" }, { errorCode: "different_failure" }, { attempts: 0 },
      { payload: "{}" }, { receiptId }, { httpStatus: 503 }, { deliveredAt: new Date() },
      { status: "processing", leaseId: randomUUID(), leaseUntil: new Date(Date.now() + 60_000) },
    ];
    const ledgerBefore = (await db.query('SELECT * FROM credit_transactions ORDER BY id')).rows;
    for (const [index, changed] of cases.entries()) {
      const candidate = await prisma.marketingConversion.create({ data: {
        ...blocked, id: `ineligible_${index}`, originKey: `ledger:ineligible_${index}`, ...changed,
      } });
      const before = await prisma.marketingConversion.findMany({ orderBy: { id: "asc" } });
      await expect(retry.previewMarketingRefundRetry(candidate.id, config, f.reader)).rejects.toThrow("refund_retry_ineligible");
      await expect(retry.retryMarketingRefund(candidate.id, "0".repeat(64), config, f.reader)).rejects.toThrow("refund_retry_ineligible");
      expect(await prisma.marketingConversion.findMany({ orderBy: { id: "asc" } })).toEqual(before);
      await prisma.marketingConversion.delete({ where: { id: candidate.id } });
    }
    const duplicate = await prisma.marketingConversion.create({ data: {
      ...blocked, id: "ambiguous_refund", originKey: "ledger:ambiguous_refund",
    } });
    const before = await prisma.marketingConversion.findMany({ orderBy: { id: "asc" } });
    for (const id of [blocked.id, duplicate.id]) {
      await expect(retry.previewMarketingRefundRetry(id, config, f.reader)).rejects.toThrow("refund_retry_ambiguous");
      await expect(retry.retryMarketingRefund(id, "0".repeat(64), config, f.reader)).rejects.toThrow("refund_retry_ambiguous");
    }
    expect(read).not.toHaveBeenCalled();
    expect(await prisma.marketingConversion.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    expect((await db.query('SELECT * FROM credit_transactions ORDER BY id')).rows).toEqual(ledgerBefore);
  });

  it("protects the operator route with existing auth and bounded strict input", async () => {
    const { NextRequest } = await import("next/server");
    const route = await import("../../app/api/admin/marketing/refunds/[id]/retry/route");
    const env = { ADMIN_API_SECRET: "fixture-admin-secret", UNIFIED_ADS_ENABLED: "true", UNIFIED_ADS_SOURCE_ID: config.sourceId,
      UNIFIED_ADS_ENVIRONMENT: "test", UNIFIED_ADS_SERVER_KEY: `uads_${receiptId}_${"a".repeat(43)}`, UNIFIED_ADS_FROM: config.from.toISOString(),
      NODE_ENV: "test", OCTOPUS_SELF_HOSTED: "false", NEXT_PUBLIC_OCTOPUS_SELF_HOSTED: "false" };
    const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    const context = { params: Promise.resolve({ id: "missing" }) };
    const request = (method: string, body?: string, authorized = true) => new NextRequest("http://localhost/api/admin/marketing/refunds/missing/retry", {
      method, headers: authorized ? { authorization: `Bearer ${env.ADMIN_API_SECRET}` } : {}, body,
    });
    try {
      Object.assign(process.env, env);
      expect((await route.GET(request("GET", undefined, false), context)).status).toBe(401);
      expect((await route.POST(request("POST", "{}", false), context)).status).toBe(401);
      for (const body of ["{}", "not-json", JSON.stringify({ previewHash: "0".repeat(64), extra: true }), "x".repeat(1025)]) {
        expect((await route.POST(request("POST", body), context)).status).toBe(400);
      }
      const missing = await route.GET(request("GET"), context);
      expect(missing.status).toBe(409);
      expect(missing.headers.get("cache-control")).toBe("no-store");
      delete process.env.ADMIN_API_SECRET;
      expect((await route.GET(request("GET"), context)).status).toBe(401);
    } finally {
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });

  describe("complete-period reconciliation", () => {
    const binding = { sourceId: config.sourceId, environment: "test" as const, keyId: receiptId, capabilities: ["purchases", "refunds"], project: { projectId: randomUUID(), version: 7 } };
    const scoped = { ...config, serverKey: `uads_${receiptId}_${"a".repeat(43)}` };
    // The fixture charge is created at 2026-09-14T00:00:00Z and its refund a minute later.
    const day = { from: "2026-09-14T00:00:00.000Z", to: "2026-09-15T00:00:00.000Z" };
    const now = new Date("2026-09-20T00:00:00.000Z");
    const purchaseEntry = `{"eventType":"purchase","transactionId":"${conversionId("payment", "pi_fixture")}","amountMinor":"14800","currency":"USD","occurredAt":"2026-09-14T00:00:00.000Z"}`;
    const refundEntry = `{"eventType":"refund","transactionId":"${conversionId("refund", "re_fixture")}","amountMinor":"1000","currency":"USD","occurredAt":"2026-09-14T00:01:00.000Z"}`;
    const bodyOf = (period: { from: string; to: string }, entries: string[]) => `{"schemaVersion":2,"period":{"from":"${period.from}","to":"${period.to}"},"complete":true,"entries":[${entries.join(",")}]}`;
    /** Synthetic receiver: agrees unless told otherwise, and records what it was sent. */
    function receiver(change: Record<string, unknown> = {}) {
      const bodies: string[] = []; const reconciliationId = randomUUID();
      const send = (async (input: RequestInfo | URL) => {
        const request = input as Request;
        expect(request.url.startsWith("https://ads.weezboo.com/api/conversion-events/")).toBe(true);
        if (request.method === "GET") return Response.json({ schemaVersion: 1, sourceId: config.sourceId, environment: "test", keyId: receiptId, capabilities: binding.capabilities });
        const text = await request.text(); bodies.push(text);
        const sent = JSON.parse(text) as { period: object; entries: { eventType: string }[] };
        return Response.json({ schemaVersion: 2, ...binding, period: sent.period, observation: { startedAt: now.toISOString(), completedAt: now.toISOString() }, agreeing: true,
          declared: { purchases: sent.entries.filter(e => e.eventType === "purchase").length, refunds: sent.entries.filter(e => e.eventType === "refund").length },
          notReceived: { count: 0, entries: [] }, notDeclared: { purchases: 0, refunds: 0 }, reconciliationId, ...change });
      }) as typeof fetch;
      return { send, bodies, reconciliationId };
    }
    const state = async () => ({
      outbox: await prisma.marketingConversion.findMany({ orderBy: { id: "asc" } }),
      ledger: (await db.query("SELECT * FROM credit_transactions ORDER BY id")).rows,
      organizations: (await db.query("SELECT * FROM organizations ORDER BY id")).rows,
      attributions: (await db.query("SELECT * FROM marketing_payment_attributions ORDER BY id")).rows,
    });
    const observations = async () => Number((await db.query("SELECT count(*) FROM marketing_cash_observations")).rows[0].count);
    /** Real capture and dispatch of every due row; returns the bytes the receiver was sent. */
    async function deliver(f = fixture()) {
      const sent: string[] = [];
      await outbox.captureMarketingConversions(config);
      for (;;) {
        const row = await outbox.claimMarketingConversion(config);
        if (!row) return sent;
        expect(await outbox.processMarketingConversion(row, config, f.reader, withIdentity(async request => { const text = await request.text(); const duplicate = sent.includes(text); sent.push(text); return received(duplicate); }))).toBe("delivered");
      }
    }
    const deliveredRow = (i: number) => {
      const occurredAt = new Date(Date.parse("2026-10-01T00:00:00.000Z") + i * 1000); const id = `payment_${String(i).padStart(4, "0")}`;
      return { sourceId: config.sourceId, environment: "test", originKey: `payment:pi_${i}`, kind: "purchase", reference: `pi_${i}`, organizationId: "org_fixture", sourceCreatedAt: occurredAt,
        payload: JSON.stringify({ schemaVersion: 1, eventId: id, eventType: "purchase", transactionId: id, customerId: "organization_a", occurredAt: occurredAt.toISOString(), amountMinor: "100", currency: "USD", purchaseKind: "top_up" }),
        status: "delivered", receiptId: randomUUID(), httpStatus: 201, deliveredAt: occurredAt };
    };

    it("declares exactly the delivered in-period rows from the bytes that were sent, and changes nothing else", async () => {
      const reconcile = await import("../marketing-cash-reconcile"); const observation = await import("../marketing-cash-observation");
      await ledger("refund", "usage", null, "re_fixture");
      await ledger("cs_purchase", "subscription", "cs_fixture");
      await ledger("pi_purchase", "subscription", "pi_fixture");
      const f = fixture(); f.payment.metadata = {};
      const dispatched = [...new Set(await deliver(f))].map(text => JSON.parse(text));
      expect(dispatched).toHaveLength(2);
      expect(await prisma.marketingConversion.count({ where: { kind: "purchase", status: "delivered" } })).toBeGreaterThanOrEqual(2);
      const before = await state();

      const agreeing = receiver();
      const result = await reconcile.reconcileCashPeriod(scoped, binding, day, agreeing.send, now);
      expect(result).toMatchObject({ outcome: "agreed", sent: true });
      // Aliases are declared once, and each value is the one in the delivered bytes.
      expect(agreeing.bodies).toEqual([bodyOf(day, [purchaseEntry, refundEntry])]);
      for (const entry of JSON.parse(agreeing.bodies[0]!).entries) {
        expect(dispatched.find(event => event.transactionId === entry.transactionId)).toMatchObject({ eventType: entry.eventType, amountMinor: entry.amountMinor, currency: entry.currency, occurredAt: entry.occurredAt });
      }
      expect(result.observation!.document).toMatchObject({ contract: "receipt-reconciliation/v2", period: day, requestedFrom: null, outcome: "agreed", sent: true, declared: { purchases: 1, refunds: 1 },
        requestDigest: createHash("sha256").update(agreeing.bodies[0]!).digest("hex"), reconciliationId: agreeing.reconciliationId, receiverStatus: 200, ledgerFactNotCaptured: false, undelivered: {}, upstreamCompleteness: "unknown" });
      expect(result.observation!.document.responseDigest).toMatch(/^[0-9a-f]{64}$/);

      // The observation is immutable and readable through the existing operator read.
      const stored = (await db.query("SELECT kind, \"parentId\" FROM marketing_cash_observations WHERE id=$1", [result.observation!.id])).rows;
      expect(stored).toEqual([{ kind: "comparison", parentId: null }]);
      await expect(db.query("UPDATE marketing_cash_observations SET body=$1 WHERE id=$2", ["{}", result.observation!.id])).rejects.toThrow();
      await expect(db.query("DELETE FROM marketing_cash_observations WHERE id=$1", [result.observation!.id])).rejects.toThrow();
      expect(await observation.getCashObservation(scoped, result.observation!.id)).toEqual(result.observation!);

      // A refund inside the period whose original payment is before it: the original is not declared.
      const afterCharge = { from: "2026-09-14T00:00:30.000Z", to: day.to }; const refundOnly = receiver();
      expect((await reconcile.reconcileCashPeriod(scoped, binding, afterCharge, refundOnly.send, now)).outcome).toBe("agreed");
      expect(refundOnly.bodies).toEqual([bodyOf(afterCharge, [refundEntry])]);
      // A period with nothing in it is declared empty.
      const quiet = { from: "2026-09-15T00:00:00.000Z", to: "2026-09-16T00:00:00.000Z" }; const none = receiver();
      expect((await reconcile.reconcileCashPeriod(scoped, binding, quiet, none.send, now)).observation!.document).toMatchObject({ outcome: "agreed", declared: { purchases: 0, refunds: 0 } });
      expect(none.bodies).toEqual([bodyOf(quiet, [])]);
      // A receiver that holds an undeclared purchase disagrees; nothing is saved there and the reason is stored here.
      const disagreeing = receiver({ agreeing: false, reconciliationId: null, notDeclared: { purchases: 1, refunds: 0 } });
      const disagreed = await reconcile.reconcileCashPeriod(scoped, binding, day, disagreeing.send, now);
      expect(disagreed.observation!.document).toMatchObject({ outcome: "disagreed", sent: true, reconciliationId: null, receiver: { notDeclared: { purchases: 1, refunds: 0 } } });

      // A refused period is not an observation; a changed binding sends nothing.
      const count = await observations(); const unused = receiver();
      expect(await reconcile.reconcileCashPeriod(scoped, binding, { from: "2026-09-08T00:00:00.000Z", to: day.to }, unused.send, now)).toEqual({ outcome: "period_before_activation", sent: false, observation: null });
      expect(await reconcile.reconcileCashPeriod(scoped, binding, { from: day.from, to: "2026-09-21T00:00:00.000Z" }, unused.send, now)).toEqual({ outcome: "period_in_future", sent: false, observation: null });
      await expect(reconcile.reconcileCashPeriod(scoped, { ...binding, project: { ...binding.project, version: 0 } }, day, unused.send, now)).rejects.toThrow();
      expect(unused.bodies).toEqual([]); expect(await observations()).toBe(count);
      expect(await state()).toEqual(before);
    });

    it("refuses with the reason for each kind of gap, without sending", async () => {
      const reconcile = await import("../marketing-cash-reconcile");
      const unused = receiver();
      const refused = async (reason: string, undelivered: Record<string, number>, ledgerFactNotCaptured = false) => {
        const before = await state(); const count = await observations();
        const result = await reconcile.reconcileCashPeriod(scoped, binding, day, unused.send, now);
        expect(result).toMatchObject({ outcome: reason, sent: false });
        expect(result.observation!.document).toMatchObject({ outcome: reason, sent: false, declared: null, requestDigest: null, reconciliationId: null, undelivered, ledgerFactNotCaptured });
        expect(unused.bodies).toEqual([]); expect(await observations()).toBe(count + 1); expect(await state()).toEqual(before);
      };
      // An eligible ledger fact that capture has not seen.
      await ledger("gap_cash", "purchase", "pi_fixture");
      await refused("ledger_fact_not_captured", {}, true);
      // Captured, payload unresolved.
      await outbox.captureMarketingConversions(config);
      await refused("delivery_pending", { pending: 1 });
      // Leased by a worker.
      const claimed = (await outbox.claimMarketingConversion(config))!;
      await refused("delivery_pending", { processing: 1 });
      // Bytes saved, acknowledgement lost.
      expect(await outbox.processMarketingConversion(claimed, config, fixture().reader, withIdentity(async () => { throw new Error("synthetic lost acknowledgement"); }))).toBe("retry");
      expect((await prisma.marketingConversion.findUniqueOrThrow({ where: { id: claimed.id } })).payload).not.toBeNull();
      await refused("delivery_pending", { pending: 1 });
      // Held by the receiver or the resolver.
      await due(claimed.id);
      await outbox.finishMarketingConversion((await outbox.claimMarketingConversion(config))!, { kind: "blocked", code: "receiver_conflict" });
      await refused("delivery_blocked", { blocked: 1 });
      // One blocked row anywhere refuses a period it may not even belong to.
      const before = await observations();
      expect((await reconcile.reconcileCashPeriod(scoped, binding, { from: "2026-09-16T00:00:00.000Z", to: "2026-09-17T00:00:00.000Z" }, unused.send, now)).outcome).toBe("delivery_blocked");
      expect(await observations()).toBe(before + 1);

      // Delivered rows that cannot be declared as one event.
      await db.query("TRUNCATE marketing_conversions, credit_transactions");
      await prisma.marketingConversion.createMany({ data: [deliveredRow(0), { ...deliveredRow(0), originKey: "payment:pi_alias", payload: deliveredRow(0).payload.replace('"100"', '"101"') }] });
      const october = { from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z" };
      expect((await reconcile.reconcileCashPeriod(scoped, binding, october, unused.send, new Date("2026-10-03T00:00:00.000Z"))).outcome).toBe("alias_conflict");
      await db.query("TRUNCATE marketing_conversions");
      await prisma.marketingConversion.create({ data: { ...deliveredRow(0), payload: "{}" } });
      expect((await reconcile.reconcileCashPeriod(scoped, binding, october, unused.send, new Date("2026-10-03T00:00:00.000Z"))).outcome).toBe("payload_invalid");
      expect(unused.bodies).toEqual([]);
    });

    it("declares exactly 1,000 entries, refuses 1,001, and the trailing window moves forward to the largest that fits", async () => {
      const reconcile = await import("../marketing-cash-reconcile");
      const week = { from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" }; const at = new Date("2026-10-08T02:00:00.000Z");
      await prisma.marketingConversion.createMany({ data: Array.from({ length: 1000 }, (_, i) => deliveredRow(i)) });
      const full = receiver();
      expect((await reconcile.reconcileCashPeriod(scoped, binding, week, full.send, at)).observation!.document).toMatchObject({ outcome: "agreed", declared: { purchases: 1000, refunds: 0 }, fitsFrom: null });
      // The same frozen vector as the contract test, through the real read.
      expect(Buffer.byteLength(full.bodies[0]!)).toBe(133124);
      expect(createHash("sha256").update(full.bodies[0]!).digest("hex")).toBe("cc5d05e6ee4f8bac5a109d79c7d9d64a4c37e31cd88f72005d5555d06fb16475");

      await prisma.marketingConversion.create({ data: deliveredRow(1000) });
      const over = receiver();
      const refused = await reconcile.reconcileCashPeriod(scoped, binding, week, over.send, at);
      expect(refused.observation!.document).toMatchObject({ outcome: "too_many_entries", sent: false, declared: null, requestDigest: null, fitsFrom: "2026-10-01T00:00:00.001Z" });
      expect(over.bodies).toEqual([]);

      // Two hours before the run, back to activation; then forward to the first start that holds 1,000.
      const count = await observations(); const trailing = receiver();
      const result = await reconcile.reconcileTrailingCashWindow(scoped, binding, at, trailing.send);
      expect(result.observation!.document).toMatchObject({ outcome: "agreed", period: { from: "2026-10-01T00:00:00.001Z", to: week.to }, requestedFrom: "2026-09-09T00:00:00.000Z", declared: { purchases: 1000, refunds: 0 } });
      expect(trailing.bodies).toHaveLength(1); expect(JSON.parse(trailing.bodies[0]!).entries).toHaveLength(1000);
      expect(JSON.parse(trailing.bodies[0]!).entries[0].transactionId).toBe("payment_0001");
      expect(await observations()).toBe(count + 2);
      // No more than 92 days, even long after activation.
      const later = new Date("2027-03-01T02:00:00.000Z"); const wide = receiver();
      expect((await reconcile.reconcileTrailingCashWindow(scoped, binding, later, wide.send)).observation!.document.period).toEqual({ from: "2026-11-29T00:00:00.000Z", to: "2027-03-01T00:00:00.000Z" });
      expect(await reconcile.reconcileTrailingCashWindow({ ...scoped, from: later }, binding, later, wide.send)).toEqual({ outcome: "period_before_activation", sent: false, observation: null });
    });

    it("runs the scheduled job only with its flag and binding, and the operator route only for an authorized strict request", async () => {
      const reconcile = await import("../marketing-cash-reconcile");
      await ledger("job_cash", "purchase", "pi_fixture");
      await deliver();
      const env = { UNIFIED_ADS_ENABLED: "true", UNIFIED_ADS_RECONCILIATION_ENABLED: "true", UNIFIED_ADS_SOURCE_ID: config.sourceId, UNIFIED_ADS_ENVIRONMENT: "test",
        UNIFIED_ADS_SERVER_KEY: scoped.serverKey, UNIFIED_ADS_FROM: config.from.toISOString(), UNIFIED_ADS_CASH_EXPECTED_BINDING: JSON.stringify(binding), NODE_ENV: "test" };
      const count = await observations(); const unused = receiver();
      for (const [change, outcome] of [[{ UNIFIED_ADS_RECONCILIATION_ENABLED: undefined }, "disabled"], [{ UNIFIED_ADS_RECONCILIATION_ENABLED: "false" }, "disabled"], [{ UNIFIED_ADS_ENABLED: "false" }, "disabled"],
        [{ NODE_ENV: "production" }, "production_requires_live_source"], [{ UNIFIED_ADS_CASH_EXPECTED_BINDING: undefined }, "binding_invalid"]] as const) {
        expect(await reconcile.runCashReconciliation({ ...env, ...change }, now, unused.send)).toEqual({ outcome, sent: false, observation: null });
      }
      expect(unused.bodies).toEqual([]); expect(await observations()).toBe(count);
      const job = receiver();
      const ran = await reconcile.runCashReconciliation(env, now, job.send);
      expect(ran.observation!.document).toMatchObject({ outcome: "agreed", period: { from: "2026-09-09T00:00:00.000Z", to: "2026-09-19T22:00:00.000Z" }, declared: { purchases: 1, refunds: 0 } });

      const { NextRequest } = await import("next/server");
      const route = await import("../../app/api/admin/marketing/cash-observations/route");
      const routeEnv = { ...env, ADMIN_API_SECRET: "fixture-admin-secret", OCTOPUS_SELF_HOSTED: "false", NEXT_PUBLIC_OCTOPUS_SELF_HOSTED: "false" };
      const previous = Object.fromEntries(Object.keys(routeEnv).map(key => [key, process.env[key]]));
      const post = (body: unknown, authorized = true) => route.POST(new NextRequest("http://localhost/api/admin/marketing/cash-observations", {
        method: "POST", headers: { "content-type": "application/json", ...(authorized ? { authorization: `Bearer ${routeEnv.ADMIN_API_SECRET}` } : {}) }, body: JSON.stringify(body) }));
      try {
        Object.assign(process.env, routeEnv);
        expect((await post({ operation: "reconcile", ...day }, false)).status).toBe(401);
        for (const body of [{ operation: "reconcile", from: day.from }, { operation: "reconcile", ...day, predecessor: null }, { operation: "reconcile", from: 1, to: day.to }, { operation: "reconcile", id: "x" }]) {
          expect((await post(body)).status).toBe(400);
        }
        const future = await post({ operation: "reconcile", from: day.from, to: "2999-01-01T00:00:00.000Z" });
        expect(future.status).toBe(400); expect(await future.json()).toEqual({ error: "Period refused", reason: "period_in_future" });
        expect(future.headers.get("cache-control")).toBe("no-store");
        // A gap answers from the stored observation; the route's real transport is never reached.
        await ledger("route_gap", "purchase", "pi_route_gap");
        const gap = await post({ operation: "reconcile", ...day });
        expect(gap.status).toBe(201); expect((await gap.json()).document).toMatchObject({ outcome: "ledger_fact_not_captured", sent: false });
        delete process.env.UNIFIED_ADS_CASH_EXPECTED_BINDING;
        expect((await post({ operation: "reconcile", ...day })).status).toBe(503);
      } finally {
        for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      }
    });
  });
});
