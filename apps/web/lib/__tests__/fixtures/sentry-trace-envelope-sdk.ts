import assert from "node:assert/strict";
import * as Sentry from "@sentry/nextjs";
import { scrubDynamicSamplingContext, scrubEvent } from "../../sentry-scrub";
import { scrubStreamedSpan, scrubTransaction } from "../../sentry-trace-envelope";

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
  ...(process.argv[2] === "edge-stream" ? { integrations: [Sentry.spanStreamingIntegration()] } : {}),
  beforeSend: scrubEvent, beforeSendSpan: Sentry.withStreamedSpan(scrubStreamedSpan), beforeSendTransaction: scrubTransaction,
  transport: () => ({ send: async (envelope) => { envelopes.push(envelope); return { statusCode: 200 }; }, flush: async () => true }) });
Sentry.getClient()?.on("createDsc", scrubDynamicSamplingContext);
let propagated = "";
await Sentry.startSpan({ name: `GET https://example.invalid${path}?code=${query}`, op: "http.server", attributes: {
  "url.full": `https://example.invalid${path}?code=${query}`, "http.request.header.x_probe": header,
  "http.request.body.data": body, "gen_ai.usage.input_tokens": 42,
} }, async () => {
  Sentry.addBreadcrumb({ category: "http", type: "http", data: { method: "GET", status_code: 200, "http.query": query } });
  propagated = JSON.stringify(Sentry.getTraceData());
  await Sentry.startSpan({ name: `GET ${path}?code=${query}`, op: "http.client", attributes: {
    "url.full": `https://example.invalid${path}?code=${query}`, "http.response.header.x_probe": header,
  } }, async () => {});
});
await Sentry.flush(3000);
const serialized = JSON.stringify(envelopes);
if (process.argv[2] !== "unsampled") {
  assert.ok(envelopes.length > 0 && serialized.includes("gen_ai.usage.input_tokens"));
  const types = (envelopes as Array<[unknown, Array<[{ type?: string }, unknown]>]>).flatMap(envelope => envelope[1].map(item => item[0].type));
  assert.ok(types.includes(process.argv[2]?.includes("stream") ? "span" : "transaction"), `expected trace envelope was not emitted: ${types.join(",")}`);
  for (const value of [query, header, body, job]) assert.ok(!serialized.includes(value), "trace envelope retained synthetic private metadata");
  assert.ok(!propagated.includes(query) && !propagated.includes(job), "new trace baggage retained synthetic private metadata");
} else {
  assert.ok(!serialized.includes('"type":"transaction"') && !serialized.includes('"type":"span"'));
}
await Sentry.close(3000);
