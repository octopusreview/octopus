import type { ErrorEvent, Event as SentryEvent } from "@sentry/nextjs";
import { isIndexingMilestone } from "./indexing-milestone";

// Error events may contain sensitive data supplied by application code even
// when Sentry's automatic PII collection is disabled.
const SENSITIVE_KEY_RX =
  /(authorization|cookie|password|secret|token|api[-_]?key|private[-_]?key|webhook[-_]?secret|access[-_]?token|client[-_]?secret|dsn|credential)/i;

function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RX.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

type Breadcrumb = NonNullable<ErrorEvent["breadcrumbs"]>[number];
const BREADCRUMB_CATEGORIES = new Set(["console", "http", "fetch", "xhr", "navigation", "ui.click", "ui.input", "sentry.event", "sentry.transaction"]);
const BREADCRUMB_TYPES = new Set(["default", "debug", "error", "http", "info", "navigation", "query", "transaction", "user"]);
const BREADCRUMB_LEVELS = new Set(["debug", "info", "log", "warning", "error", "fatal"]);
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "CONNECT", "TRACE"]);

function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  // Breadcrumb messages and arbitrary data can contain request or user content.
  const category = breadcrumb.category && BREADCRUMB_CATEGORIES.has(breadcrumb.category) ? breadcrumb.category : "custom";
  const safe: Breadcrumb = { category };
  if (breadcrumb.type && BREADCRUMB_TYPES.has(breadcrumb.type)) safe.type = breadcrumb.type;
  if (breadcrumb.level && BREADCRUMB_LEVELS.has(breadcrumb.level)) safe.level = breadcrumb.level;
  if (typeof breadcrumb.timestamp === "number" && Number.isFinite(breadcrumb.timestamp)) safe.timestamp = breadcrumb.timestamp;
  if (["http", "fetch", "xhr"].includes(category) && breadcrumb.data && typeof breadcrumb.data === "object") {
    const method = breadcrumb.data.method ?? breadcrumb.data["http.method"];
    const status = breadcrumb.data.status_code ?? breadcrumb.data["http.status_code"];
    const data: Record<string, unknown> = {};
    if (typeof method === "string" && HTTP_METHODS.has(method.toUpperCase())) data.method = method.toUpperCase();
    if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) data.status_code = status;
    if (Object.keys(data).length) safe.data = data;
  }
  return safe;
}

export function sanitizeRequestUrl(value: string, allowRelative = false): string | undefined {
  try {
    const relative = allowRelative && value.startsWith("/") && !value.startsWith("//");
    const url = relative ? new URL(value, "https://sentry.invalid") : new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (/^\/api\/github-action\/review\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(decodeURIComponent(url.pathname))) {
      url.pathname = "/api/github-action/review/[jobId]";
    }
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return relative ? url.pathname : url.toString();
  } catch {
    return undefined;
  }
}

export function sanitizeTraceDescription(value: string): string {
  // shortcut: arbitrary free text is not sanitized, upgrade when trace names use an allowlist.
  const match = /^([A-Za-z]+\s+)?(https?:\/\/\S+|\/\S+)(.*)$/i.exec(value);
  if (!match) return value;
  const safe = sanitizeRequestUrl(match[2], true);
  return safe === undefined ? "[redacted]" : `${match[1] ?? ""}${safe}`;
}

export function scrubDynamicSamplingContext(context: { transaction?: string }): void {
  if (context.transaction) context.transaction = sanitizeTraceDescription(context.transaction);
}

const TRACE_URL_KEYS = new Set(["url", "url.full", "url.path", "http.url", "http.target", "http.route"]);
const TRACE_PRIVATE_KEYS = /(?:^|[._-])(?:headers?|cookies?|query|fragment|body|baggage)(?:$|[._-])/i;
const TOKEN_COUNT = /(?:^|[._-])(input|output|total|prompt|completion|cache_read|cache_write)[._-]tokens?$/i;

export function scrubTraceAttributes(data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (TRACE_PRIVATE_KEYS.test(key) || (SENSITIVE_KEY_RX.test(key) && !(typeof value === "number" && TOKEN_COUNT.test(key)))) {
      delete data[key];
    } else if (key.toLowerCase() === "sentry.segment.name") {
      if (typeof value === "string") data[key] = sanitizeTraceDescription(value);
      else delete data[key];
    } else if (TRACE_URL_KEYS.has(key.toLowerCase())) {
      const safe = typeof value === "string" ? sanitizeRequestUrl(value, true) : undefined;
      if (safe === undefined) delete data[key];
      else data[key] = safe;
    } else if (value !== null && typeof value === "object" &&
        (!Array.isArray(value) || value.some(item => typeof item !== "number" && typeof item !== "boolean"))) {
      delete data[key];
    }
  }
}

/**
 * Parse a 0..1 Sentry sample rate from env, falling back on missing or invalid
 * input so a fat-fingered value can't turn into a NaN/out-of-range rate.
 */
export function parseRate(raw: string | undefined, fallback: number): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

/** Drop sensitive request metadata and redact sensitive keys from an event. */
export function scrubEvent<T extends SentryEvent>(event: T): T {
  const traceData = event.contexts?.trace?.data ? { ...event.contexts.trace.data } : undefined;
  if (traceData) scrubTraceAttributes(traceData);
  if (event.tags?.error_boundary === "background") {
    // A caught SDK error must not inherit request/user/console payloads from its worker scope.
    delete event.request;
    delete event.user;
    delete event.extra;
    delete event.breadcrumbs;
    delete event.exception;
    delete event.transaction;
    event.contexts = { background_failure: event.contexts?.background_failure };
    event.tags = Object.fromEntries(Object.entries(event.tags).filter(([key]) =>
      ["error_boundary", "failure_stage", "failure_owner", "failure_code", "provider", "outcome", "synthetic", "preparation_operation", "indexing_deadline", "indexing_last_milestone"].includes(key)));
    if (event.tags.preparation_operation !== "review_input" && event.tags.preparation_operation !== "repository_tree") {
      delete event.tags.preparation_operation;
    }
    if (event.tags.indexing_deadline !== "worker_25m") delete event.tags.indexing_deadline;
    if (event.tags.failure_stage !== "indexing" || event.tags.indexing_deadline !== "worker_25m" || !isIndexingMilestone(event.tags.indexing_last_milestone)) delete event.tags.indexing_last_milestone;
  }
  if (event.request) {
    delete (event.request as { cookies?: unknown }).cookies;
    delete (event.request as { headers?: unknown }).headers;
    delete (event.request as { data?: unknown }).data;
    delete (event.request as { query_string?: unknown }).query_string;
    if (event.request.url) {
      event.request.url = sanitizeRequestUrl(event.request.url);
    }
  }
  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.filter((breadcrumb) => breadcrumb && typeof breadcrumb === "object").map(scrubBreadcrumb);
  } else {
    delete event.breadcrumbs;
  }
  if (event.extra) event.extra = redact(event.extra) as Record<string, unknown>;
  if (event.contexts) {
    event.contexts = redact(event.contexts) as typeof event.contexts;
  }
  if (traceData && event.contexts?.trace) event.contexts.trace.data = traceData;
  if (event.transaction) event.transaction = sanitizeTraceDescription(event.transaction);
  if (event.sdkProcessingMetadata?.dynamicSamplingContext?.transaction) {
    event.sdkProcessingMetadata.dynamicSamplingContext.transaction = sanitizeTraceDescription(event.sdkProcessingMetadata.dynamicSamplingContext.transaction);
  }
  return event;
}

/** Browser-specific filtering; server and edge events always use scrubEvent. */
export function scrubBrowserEvent(event: ErrorEvent): ErrorEvent | null {
  const values = event.exception?.values;
  // Require the complete observed wallet-extension chain and its exact injected
  // script path. Similar messages, unknown stacks and mixed app frames stay visible.
  if (values?.some((value) => value.value === "MetaMask extension not found") &&
      values.some((value) => value.value === "Failed to connect to MetaMask") &&
      values.every((value) =>
        (value.value === "MetaMask extension not found" || value.value === "Failed to connect to MetaMask") &&
        value.stacktrace?.frames?.length &&
        value.stacktrace.frames.every((frame) => frame.filename === "app:///scripts/inpage.js"))) {
    return null;
  }
  return scrubEvent(event);
}
