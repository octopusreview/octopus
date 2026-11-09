import { describe, expect, it } from "bun:test";
import type * as Sentry from "@sentry/nextjs";
import { scrubSpan, scrubStreamedSpan, scrubTransaction } from "@/lib/sentry-trace-envelope";
import { sanitizeRequestUrl } from "@/lib/sentry-scrub";

type Options = NonNullable<Parameters<typeof Sentry.init>[0]>;
type Span = Parameters<NonNullable<Options["beforeSendSpan"]>>[0];
type Transaction = Parameters<NonNullable<Options["beforeSendTransaction"]>>[0];

describe("Sentry trace request metadata", () => {
  it("sanitizes request metadata in transactions and child spans while preserving bounded metrics", () => {
    const jobId = "11111111-1111-4111-8111-111111111111";
    const path = `/api/github-action/review/${jobId}`;
    const span: Span = { span_id: "1111111111111111", trace_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", start_timestamp: 1,
      description: `GET https://example.invalid${path}?code=synthetic-query`,
      data: { "url.full": `https://example.invalid${path}?code=synthetic-query`, "url.query": "synthetic-query",
        "http.request.header.x_probe": "synthetic-header", "http.request.body.data": "synthetic-body",
        "gen_ai.usage.input_tokens": 42, "http.response.status_code": 200 } };
    const event: Transaction = { type: "transaction", transaction: `GET ${path}?code=synthetic-query`,
      request: { url: `https://example.invalid${path}?code=synthetic-query`, headers: { "x-probe": "synthetic-header" },
        data: "synthetic-body", query_string: "code=synthetic-query" },
      contexts: { trace: { trace_id: span.trace_id, span_id: span.span_id, data: { "http.request.header.x_probe": "synthetic-header",
        "http.query": "synthetic-query", "http.response.status_code": 200 } } },
      breadcrumbs: [{ category: "http", type: "http", data: { method: "GET", status_code: 200, "http.query": "synthetic-query" } }],
      spans: [span] };
    expect(scrubTransaction(event)).toBe(event);
    const serialized = JSON.stringify(event);
    for (const value of [jobId, "synthetic-query", "synthetic-header", "synthetic-body"]) expect(serialized).not.toContain(value);
    expect(event.request?.url).toBe("https://example.invalid/api/github-action/review/[jobId]");
    expect(event.transaction).toBe("GET /api/github-action/review/[jobId]");
    expect(event.spans?.[0]?.data["gen_ai.usage.input_tokens"]).toBe(42);
    expect(event.spans?.[0]?.data["http.response.status_code"]).toBe(200);
    expect(event.breadcrumbs?.[0]?.data).toEqual({ method: "GET", status_code: 200 });
  });

  it("sanitizes legacy child spans without removing safe numeric arrays", () => {
    const span: Span = { span_id: "1111111111111111", trace_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", start_timestamp: 1,
      description: "GET https://user:password@example.invalid/path?code=synthetic-query#synthetic-fragment synthetic-suffix",
      data: { "http.response.header.x_custom": "synthetic-header", "url.query": "synthetic-query",
        "url.full": "https://user:password@example.invalid/path?code=synthetic-query#synthetic-fragment", counts: [1, 2] } };
    expect(scrubSpan(span)).toBe(span);
    expect(JSON.stringify(span)).not.toContain("synthetic-");
    expect(span.description).toBe("GET https://example.invalid/path");
    expect(span.data.counts).toEqual([1, 2]);
  });

  it("removes private link attributes and fails closed on malformed URL paths", () => {
    const span = {
      name: "GET /safe?private=synthetic-query",
      attributes: { "sentry.segment.name": "GET /safe?private=synthetic-query" },
      links: [{ trace_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", span_id: "1111111111111111",
        attributes: { "http.request.header.x_probe": "synthetic-header", "http.response.status_code": 200 } }],
    } as Parameters<typeof scrubStreamedSpan>[0];
    scrubStreamedSpan(span);
    expect(JSON.stringify(span)).not.toContain("synthetic-");
    expect(span.links?.[0]?.attributes?.["http.response.status_code"]).toBe(200);
    expect(sanitizeRequestUrl("https://example.invalid/%zz?private=synthetic-query")).toBeUndefined();
  });
});
