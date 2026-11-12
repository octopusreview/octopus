// Edge-runtime Sentry init (middleware / edge routes). Minimal: no replay or
// heavy integrations on the edge. DSN read from env at runtime (self-host safe).
import * as Sentry from "@sentry/nextjs";
import { scrubDynamicSamplingContext, scrubEvent, parseRate } from "@/lib/sentry-scrub";
import { scrubEnvelope, scrubStreamedSpan, scrubTransaction } from "@/lib/sentry-trace-envelope";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment:
    process.env.SENTRY_ENVIRONMENT ??
    (process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED === "true" ? "self-hosted" : "production"),
  release: process.env.NEXT_PUBLIC_APP_VERSION,
  tracesSampleRate: parseRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.1),
  sendDefaultPii: false,
  beforeSend: (event) => scrubEvent(event),
  beforeSendSpan: Sentry.withStreamedSpan(scrubStreamedSpan),
  beforeSendTransaction: (event) => scrubTransaction(event),
});
Sentry.getClient()?.on("createDsc", scrubDynamicSamplingContext);
Sentry.getClient()?.on("beforeEnvelope", scrubEnvelope);
