import type { ErrorEvent } from "@sentry/nextjs";
import { isIndexingMilestone } from "./indexing-milestone";

// This app handles payment, OAuth tokens, webhook secrets, and API keys, so we
// scrub aggressively before anything leaves the process. `sendDefaultPii: false`
// already keeps Sentry from attaching cookies/headers/IP; this is belt-and-
// suspenders for anything that reaches `extra`/`contexts` via our own code.
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
export function scrubEvent(event: ErrorEvent): ErrorEvent {
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
      try {
        const url = new URL(event.request.url);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Invalid request URL");
        if (/^\/api\/github-action\/review\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(decodeURIComponent(url.pathname))) {
          url.pathname = "/api/github-action/review/[jobId]";
        }
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        event.request.url = url.toString();
      } catch {
        delete event.request.url;
      }
    }
  }
  if (event.extra) event.extra = redact(event.extra) as Record<string, unknown>;
  if (event.contexts) {
    event.contexts = redact(event.contexts) as typeof event.contexts;
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
