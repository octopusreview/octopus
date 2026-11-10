import assert from "node:assert/strict";
import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "../../sentry-scrub";

const target = new URL(process.env.OCTOPUS_TEST_BREADCRUMB_TARGET!);
const query = process.env.OCTOPUS_TEST_BREADCRUMB_QUERY!;
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.protocol, "http:");
assert.ok(query);
target.searchParams.set("code", query);
const envelopes: unknown[] = [];
Sentry.init({ dsn: "https://synthetic@example.invalid/1", sendDefaultPii: false, beforeSend: scrubEvent,
  transport: () => ({ send: async (envelope) => { envelopes.push(envelope); return { statusCode: 200 }; }, flush: async () => true }) });
const response = await fetch(target);
await response.text();
await new Promise(resolve => setTimeout(resolve, 50));
Sentry.captureException(new Error("synthetic safe failure"));
await Sentry.flush(3000);
const serialized = JSON.stringify(envelopes);
assert.ok(envelopes.length > 0 && serialized.includes("synthetic safe failure"));
assert.ok(!serialized.includes(query));
assert.ok(serialized.includes('"category":"http"') && serialized.includes('"method":"GET"') && serialized.includes('"status_code":200'));
await Sentry.close(3000);
