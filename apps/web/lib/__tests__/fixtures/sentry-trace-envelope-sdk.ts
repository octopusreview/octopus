import assert from "node:assert/strict";
import * as Sentry from "@sentry/nextjs";
import { scrubDynamicSamplingContext, scrubEvent } from "../../sentry-scrub";
import { scrubEnvelopeHeader, scrubStreamedSpan, scrubTransaction } from "../../sentry-trace-envelope";

const query = process.env.OCTOPUS_TEST_TRACE_QUERY!;
const header = process.env.OCTOPUS_TEST_TRACE_HEADER!;
const body = process.env.OCTOPUS_TEST_TRACE_BODY!;
const job = process.env.OCTOPUS_TEST_TRACE_JOB!;
assert.ok(query && header && body && job);
const path = `/api/github-action/review/${job}`;
const envelopes: unknown[] = [];
globalThis.fetch = async () => { throw new Error("Unexpected external request"); };
Sentry.init({ dsn: "https://synthetic@example.invalid/1", sendDefaultPii: false,
  tracesSampleRate: process.argv[2] === "unsampled" ? 0 : 1,
  ...(process.argv[2]?.includes("stream") ? { traceLifecycle: "stream" as const } : {}),
  ...(process.argv[2]?.startsWith("edge") && process.argv[2]?.includes("stream") ? { integrations: [Sentry.spanStreamingIntegration()] } : {}),
  beforeSend: scrubEvent, beforeSendSpan: Sentry.withStreamedSpan(scrubStreamedSpan), beforeSendTransaction: scrubTransaction,
  transport: () => ({ send: async (envelope) => { envelopes.push(envelope); return { statusCode: 200 }; }, flush: async () => true }) });
Sentry.getClient()?.on("createDsc", scrubDynamicSamplingContext);
Sentry.getClient()?.on("beforeEnvelope", scrubEnvelopeHeader);
let propagated = "";
const runTrace = () => Sentry.startSpan({ name: `GET https://example.invalid${path}?code=${query}`, op: "http.server", attributes: {
  "url.full": `https://example.invalid${path}?code=${query}`, "http.request.header.x_probe": header,
  "http.request.body.data": body, "gen_ai.usage.input_tokens": 42,
} }, async () => {
  Sentry.addBreadcrumb({ category: "http", type: "http", data: { method: "GET", status_code: 200, "http.query": query } });
  propagated = JSON.stringify(Sentry.getTraceData());
  await Sentry.startSpan({ name: `GET ${path}?code=${query}`, op: "http.client", attributes: {
    "url.full": `https://example.invalid${path}?code=${query}`, "http.response.header.x_probe": header,
  } }, async () => {});
});
if (process.argv[2]?.includes("inherited")) {
  await Sentry.continueTrace({ sentryTrace: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-1",
    baggage: `sentry-trace_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,sentry-public_key=synthetic,sentry-transaction=${encodeURIComponent(`${path}?code=${query}`)}` }, runTrace);
} else {
  await runTrace();
}
await Sentry.flush(3000);
const serialized = JSON.stringify(envelopes);
if (process.argv[2] !== "unsampled") {
  assert.ok(envelopes.length > 0 && serialized.includes("gen_ai.usage.input_tokens"));
  const types = (envelopes as Array<[unknown, Array<[{ type?: string }, unknown]>]>).flatMap(envelope => envelope[1].map(item => item[0].type));
  assert.ok(types.includes(process.argv[2]?.includes("stream") ? "span" : "transaction"), `expected trace envelope was not emitted: ${types.join(",")}`);
  for (const value of [query, header, body, job]) assert.ok(!serialized.includes(value), "trace envelope retained synthetic private metadata");
  if (process.argv[2]?.includes("inherited")) {
    const trace = (envelopes as Array<[{ trace?: { trace_id?: string; public_key?: string; transaction?: string } }, unknown]>)[0]?.[0].trace;
    assert.equal(trace?.trace_id, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    assert.equal(trace?.public_key, "synthetic");
    assert.equal(trace?.transaction, "/api/github-action/review/[jobId]");
    assert.ok(propagated.includes(query), "test must retain the separate unsanitized propagation boundary");
  } else {
    assert.ok(!propagated.includes(query) && !propagated.includes(job), "new trace baggage retained synthetic private metadata");
  }
} else {
  assert.ok(!serialized.includes('"type":"transaction"') && !serialized.includes('"type":"span"'));
}
await Sentry.close(3000);
