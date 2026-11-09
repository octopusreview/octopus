import type * as Sentry from "@sentry/nextjs";
import { sanitizeTraceDescription, scrubEvent, scrubTraceAttributes } from "./sentry-scrub";

type Options = NonNullable<Parameters<typeof Sentry.init>[0]>;
type Span = Parameters<NonNullable<Options["beforeSendSpan"]>>[0];
type Transaction = Parameters<NonNullable<Options["beforeSendTransaction"]>>[0];
type StreamedSpan = Parameters<Parameters<typeof Sentry.withStreamedSpan>[0]>[0];

export function scrubSpan(span: Span): Span {
  if (span.description) span.description = sanitizeTraceDescription(span.description);
  scrubTraceAttributes(span.data);
  span.links?.forEach(link => { if (link.attributes) scrubTraceAttributes(link.attributes); });
  return span;
}

export function scrubStreamedSpan(span: StreamedSpan): StreamedSpan {
  span.name = sanitizeTraceDescription(span.name);
  if (span.attributes) scrubTraceAttributes(span.attributes);
  span.links?.forEach(link => { if (link.attributes) scrubTraceAttributes(link.attributes); });
  return span;
}

export function scrubTransaction(event: Transaction): Transaction {
  scrubEvent(event);
  event.spans?.forEach(scrubSpan);
  return event;
}
