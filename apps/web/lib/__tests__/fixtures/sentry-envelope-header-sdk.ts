import assert from "node:assert/strict";
import * as Sentry from "@sentry/nextjs";
import { scrubEnvelope } from "../../sentry-trace-envelope";

const marker = process.env.OCTOPUS_TEST_TRACE_QUERY!;
assert.ok(marker);
const envelopes: unknown[] = [];
Sentry.init({ dsn: "https://synthetic@example.invalid/1", transport: () => ({
  send: async (envelope) => { envelopes.push(envelope); return { statusCode: 200 }; }, flush: async () => true,
}) });
const client = Sentry.getClient()!;
client.on("beforeEnvelope", scrubEnvelope);
const trace = { trace_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", public_key: "synthetic", sampled: "true",
  transaction: `GET /route?query=${marker}` };
await client.sendEnvelope([{ trace }, [[{ type: "span" }, { span_id: "bbbbbbbbbbbbbbbb" }]]] as never);
assert.equal(trace.transaction, `GET /route?query=${marker}`);
const header = (envelopes[0] as [{ trace: typeof trace }, unknown])[0];
assert.deepEqual(header.trace, { ...trace, transaction: "GET /route" });
assert.ok(!JSON.stringify(envelopes).includes(marker));
await Sentry.close(3000);
