// Browser Sentry init. The client DSN is build-time inlined via
// NEXT_PUBLIC_SENTRY_DSN — baked ONLY in the hosted build (from a repo var), so
// the public self-host image ships with no DSN and client Sentry stays off.
import * as Sentry from "@sentry/nextjs";
import { scrubBrowserEvent, scrubDynamicSamplingContext, parseRate } from "@/lib/sentry-scrub";
import { scrubEnvelope, scrubStreamedSpan, scrubTransaction } from "@/lib/sentry-trace-envelope";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment:
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
    (process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED === "true" ? "self-hosted" : "production"),
  release: process.env.NEXT_PUBLIC_APP_VERSION,
  tracesSampleRate: parseRate(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE, 0.1),
  // Session Replay. This product handles payment + account data, so replays are
  // masked hard: no text, no inputs, no media is recorded. Sample a small % of
  // sessions but always keep the replay around an error.
  replaysSessionSampleRate: parseRate(
    process.env.NEXT_PUBLIC_SENTRY_REPLAY_SESSION_RATE,
    0.1,
  ),
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
  ],
  sendDefaultPii: false,
  // Browser auto-translation (Google Translate et al.) rewrites text nodes out
  // from under React, producing these DOM-manipulation errors that aren't app
  // bugs. Filtering keeps Sentry signal-rich; genuine React failures surface
  // with different messages. (Hydration errors are intentionally NOT filtered —
  // those can be real.)
  ignoreErrors: [
    "Failed to execute 'removeChild' on 'Node'",
    "Failed to execute 'insertBefore' on 'Node'",
    "The node to be removed is not a child of this node",
    "The node before which the new node is to be inserted is not a child of this node",
    // Network-layer fetch failures: a dropped/offline connection, a navigation
    // that aborts an in-flight request, or a bot/monitor that never completes
    // the request. These are unactionable client noise and differ per browser.
    // A genuine backend outage still surfaces server-side (5xx + logs), so
    // filtering these does not blind us to real problems.
    "Failed to fetch", // Chromium
    "Load failed", // Safari
    "NetworkError when attempting to fetch resource", // Firefox
  ],
  beforeSend: (event) => scrubBrowserEvent(event),
  beforeSendSpan: Sentry.withStreamedSpan(scrubStreamedSpan),
  beforeSendTransaction: (event) => scrubTransaction(event),
});
Sentry.getClient()?.on("createDsc", scrubDynamicSamplingContext);
Sentry.getClient()?.on("beforeEnvelope", scrubEnvelope);

// Lets Sentry tie client-side navigations to server transactions (Next 15+/16).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
