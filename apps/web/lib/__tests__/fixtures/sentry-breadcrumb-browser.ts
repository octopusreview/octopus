import * as Sentry from "@sentry/nextjs";
import { scrubBrowserEvent } from "../../sentry-scrub";

const marker = (window as unknown as { syntheticMarker: string }).syntheticMarker;
const envelopes: unknown[] = [];
Sentry.init({ dsn: "https://synthetic@example.invalid/1", sendDefaultPii: false, beforeSend: scrubBrowserEvent,
  transport: () => ({ send: async (envelope) => { envelopes.push(envelope); return { statusCode: 200 }; }, flush: async () => true }) });
await (await fetch(`/receiver?code=${encodeURIComponent(marker)}`)).text();
Sentry.captureException(new Error("synthetic safe failure"));
await Sentry.flush(3000);
const serialized = JSON.stringify(envelopes);
const passed = envelopes.length > 0 && serialized.includes("synthetic safe failure") && !serialized.includes(marker) &&
  serialized.includes('"category":"fetch"') && serialized.includes('"method":"GET"') && serialized.includes('"status_code":200');
document.getElementById("result")!.textContent = passed ? "pass" : "fail";
await Sentry.close(3000);
