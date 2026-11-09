import assert from "node:assert/strict";
import * as Sentry from "@sentry/nextjs";
import { scrubBrowserEvent, scrubEvent } from "../../sentry-scrub";

const query = process.env.OCTOPUS_TEST_BREADCRUMB_QUERY!;
const token = process.env.OCTOPUS_TEST_BREADCRUMB_TOKEN!;
assert.ok(query && token);
const envelopes: unknown[] = [];
globalThis.fetch = async () => { throw new Error("Unexpected external request"); };
Sentry.init({ dsn: "https://synthetic@example.invalid/1", sendDefaultPii: false,
  beforeSend: process.argv[2] === "browser" ? scrubBrowserEvent : scrubEvent,
  transport: () => ({ send: async (envelope) => { envelopes.push(envelope); return { statusCode: 200 }; }, flush: async () => true }) });
Sentry.addBreadcrumb({ category: "http", type: "http", level: "warning",
  message: `GET https://example.invalid/path?code=${query}`,
  data: { "http.method": "POST", status_code: 403, "http.query": query, authorization: token, nested: { body: token } } });
Sentry.addBreadcrumb({ category: "console", message: token, data: { arguments: [token] } });
Sentry.captureException(new Error("synthetic safe failure"));
await Sentry.flush(3000);
const serialized = JSON.stringify(envelopes);
assert.ok(envelopes.length > 0 && serialized.includes("synthetic safe failure"));
assert.ok(!serialized.includes(query) && !serialized.includes(token));
assert.ok(serialized.includes('"method":"POST"') && serialized.includes('"status_code":403'));
await Sentry.close(3000);
