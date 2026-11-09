import * as Sentry from "@sentry/nextjs";
import { scrubBrowserEvent, scrubDynamicSamplingContext } from "../../sentry-scrub";
import { scrubEnvelopeHeader, scrubStreamedSpan, scrubTransaction } from "../../sentry-trace-envelope";

const { syntheticMarker: marker, syntheticJob: job, syntheticMode: mode } = window as unknown as {
  syntheticMarker: string; syntheticJob: string; syntheticMode: string;
};
const envelopes: unknown[] = [];
Sentry.init({ dsn: "https://synthetic@example.invalid/1", sendDefaultPii: false, tracesSampleRate: 1,
  integrations: [Sentry.browserTracingIntegration(), ...(mode.includes("stream") ? [Sentry.spanStreamingIntegration()] : [])],
  ...(mode.includes("stream") ? { traceLifecycle: "stream" as const } : {}),
  beforeSend: scrubBrowserEvent, beforeSendSpan: Sentry.withStreamedSpan(scrubStreamedSpan), beforeSendTransaction: scrubTransaction,
  transport: () => ({ send: async (envelope) => { envelopes.push(envelope); return { statusCode: 200 }; }, flush: async () => true }) });
Sentry.getClient()?.on("createDsc", scrubDynamicSamplingContext);
Sentry.getClient()?.on("beforeEnvelope", scrubEnvelopeHeader);
const path = `/api/github-action/review/${job}`;
const runTrace = () => Sentry.startSpan({ name: `GET ${path}?code=${marker}`, op: "http.server", forceTransaction: true, parentSpan: null, attributes: {
  "url.full": `https://example.invalid${path}?code=${marker}`, "http.request.header.x_probe": marker,
  "gen_ai.usage.input_tokens": 42,
} }, async () => { await (await fetch(`/receiver?code=${encodeURIComponent(marker)}`)).text(); });
if (mode === "inherited-stream") {
  await Sentry.continueTrace({ sentryTrace: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-1",
    baggage: `sentry-trace_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,sentry-public_key=synthetic,sentry-transaction=${encodeURIComponent(`${path}?code=${marker}`)}` }, runTrace);
} else {
  await runTrace();
}
await Sentry.flush(3000);
const serialized = JSON.stringify(envelopes);
const types = (envelopes as Array<[unknown, Array<[{ type?: string }, unknown]>]>).flatMap(envelope => envelope[1].map(item => item[0].type));
const inheritedHeader = (envelopes as Array<[{ trace?: { trace_id?: string; public_key?: string; transaction?: string } }, unknown]>).some(
  ([header]) => header.trace?.trace_id === "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" && header.trace.public_key === "synthetic" &&
    header.trace.transaction === "/api/github-action/review/[jobId]",
);
const passed = types.includes(mode.includes("stream") ? "span" : "transaction") && !serialized.includes(marker) && !serialized.includes(job) &&
  serialized.includes("gen_ai.usage.input_tokens") && (mode !== "inherited-stream" || inheritedHeader);
document.getElementById("result")!.textContent = passed ? "pass" : JSON.stringify({ types, retainedMarker: serialized.includes(marker),
  retainedJob: serialized.includes(job), hasMetric: serialized.includes("gen_ai.usage.input_tokens"), inheritedHeader });
await Sentry.close(3000);
