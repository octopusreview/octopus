import type * as Sentry from "@sentry/nextjs";
import { sanitizeTraceDescription, scrubEvent, scrubTraceAttributes } from "./sentry-scrub";

type Options = NonNullable<Parameters<typeof Sentry.init>[0]>;
type Span = Parameters<NonNullable<Options["beforeSendSpan"]>>[0];
type Transaction = Parameters<NonNullable<Options["beforeSendTransaction"]>>[0];
type StreamedSpan = Parameters<Parameters<typeof Sentry.withStreamedSpan>[0]>[0];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function scrubLegacySpan(span: Record<string, unknown>): void {
  if (typeof span.description === "string") span.description = sanitizeTraceDescription(span.description);
  if (isRecord(span.data)) scrubTraceAttributes(span.data);
  if (Array.isArray(span.links)) {
    for (const link of span.links) {
      if (isRecord(link) && isRecord(link.attributes)) scrubTraceAttributes(link.attributes);
    }
  }
}

export function scrubEnvelope([headers, items]: [Record<string, unknown>, Array<[Record<string, unknown>, unknown]>]): void {
  const trace = headers.trace;
  if (isRecord(trace) && typeof trace.transaction === "string") {
    headers.trace = { ...trace, transaction: sanitizeTraceDescription(trace.transaction) };
  }
  for (const [itemHeader, payload] of items) {
    if (itemHeader.type === "span" && isRecord(payload) && typeof payload.span_id === "string") scrubLegacySpan(payload);
  }
}

export function scrubSpan(span: Span): Span {
  scrubLegacySpan(span as unknown as Record<string, unknown>);
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
