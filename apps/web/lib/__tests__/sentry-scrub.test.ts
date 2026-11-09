import { describe, expect, it } from "bun:test";
import type { ErrorEvent } from "@sentry/nextjs";
import { scrubBrowserEvent, scrubEvent } from "@/lib/sentry-scrub";

describe("Sentry error event scrubbing", () => {
  it("removes request bodies in every representation while retaining safe request metadata", () => {
    for (const data of [
      { githubToken: "synthetic-token", diff: "synthetic-private-content" },
      '{"githubToken":"synthetic-token"}',
      [{ nested: { apiKey: "synthetic-key" } }],
    ]) {
      const event: ErrorEvent = { message: "synthetic failure", request: {
        url: "https://example.invalid/api/review", method: "POST", data,
        headers: { authorization: "synthetic-header" }, cookies: "synthetic-cookie",
      } };
      expect(scrubEvent(event)).toBe(event);
      expect(event.request).toEqual({ url: "https://example.invalid/api/review", method: "POST" });
      expect(event.message).toBe("synthetic failure");
    }
  });

  it("fails closed for deep or cyclic data while preserving shallow diagnostics", () => {
    const cycle: Record<string, unknown> = {};
    cycle.next = cycle;
    let nested: Record<string, unknown> = { apiKey: "synthetic-deep-key" };
    for (let i = 0; i < 7; i++) nested = { next: nested };
    const event: ErrorEvent = { extra: {
      stage: "synthetic-stage", credentials: "synthetic-secret",
      nested, cycle,
    } };
    const result = scrubEvent(event);
    const encoded = JSON.stringify(result.extra);
    expect(encoded).not.toContain("synthetic-secret");
    expect(encoded).not.toContain("synthetic-deep-key");
    expect(encoded).toContain("[truncated]");
    expect(result.extra?.stage).toBe("synthetic-stage");
  });

  it("removes query strings, URL credentials and fragments while retaining a safe origin and path", () => {
    const event: ErrorEvent = { request: {
      url: "https://synthetic-user:synthetic-password@example.invalid/callback?code=synthetic-code#synthetic-fragment",
      query_string: "code=synthetic-code", method: "GET",
    } };
    scrubEvent(event);
    expect(event.request).toEqual({ url: "https://example.invalid/callback", method: "GET" });
    for (const url of ["/relative?code=synthetic-code", "not a url", "mailto:synthetic@example.invalid"]) {
      const invalid: ErrorEvent = { request: { url } };
      scrubEvent(invalid);
      expect(invalid.request?.url).toBeUndefined();
    }
  });

  it("does not retain a community review polling capability in the URL path", () => {
    const jobId = "11111111-1111-4111-8111-111111111111";
    for (const pathId of [jobId, `%31${jobId.slice(1)}`]) {
      const event: ErrorEvent = { request: { url: `https://example.invalid/api/github-action/review/${pathId}?repo=synthetic` } };
      scrubEvent(event);
      expect(event.request?.url).toBe("https://example.invalid/api/github-action/review/[jobId]");
      expect(JSON.stringify(event)).not.toContain(jobId);
    }
  });

  it("applies the same body protection to retained browser events and drops background request data", () => {
    const browser: ErrorEvent = { request: { method: "POST", data: "synthetic-body" } };
    expect(scrubBrowserEvent(browser)).toBe(browser);
    expect(browser.request).toEqual({ method: "POST" });
    const background: ErrorEvent = { tags: { error_boundary: "background" }, request: { data: "synthetic-body" } };
    expect(scrubEvent(background).request).toBeUndefined();
    const backgroundBreadcrumb: ErrorEvent = { tags: { error_boundary: "background" }, breadcrumbs: [{ message: "synthetic-secret" }] };
    expect(scrubEvent(backgroundBreadcrumb).breadcrumbs).toBeUndefined();
  });

  it("retains only bounded breadcrumb diagnostics across server and browser error events", () => {
    for (const scrub of [scrubEvent, scrubBrowserEvent]) {
      const event: ErrorEvent = { message: "safe error", breadcrumbs: [
        { category: "http", type: "http", level: "warning", timestamp: 1234,
          message: "GET https://example.invalid/path?code=synthetic-query",
          data: { "http.method": "POST", status_code: 403, "http.query": "synthetic-query",
            url: "https://example.invalid/api/github-action/review/11111111-1111-4111-8111-111111111111",
            authorization: "synthetic-token", nested: { body: "synthetic-body" } } },
        { category: "console", message: "synthetic-secret", data: { arguments: ["synthetic-secret"] } },
        { category: "xhr", type: "http", data: { method: "get", status_code: 200, url: "https://example.invalid/?code=synthetic-query" } },
        { category: "fetch", type: "http", data: { method: "synthetic-method-secret", status_code: 999 } },
        { category: "synthetic-category-secret", type: "synthetic-type-secret", level: "error", timestamp: 1235,
          data: { method: "synthetic-method-secret", status_code: 999 } },
      ] };
      expect(scrub(event)).toBe(event);
      expect(event.breadcrumbs).toEqual([
        { category: "http", type: "http", level: "warning", timestamp: 1234, data: { method: "POST", status_code: 403 } },
        { category: "console" },
        { category: "xhr", type: "http", data: { method: "GET", status_code: 200 } },
        { category: "fetch", type: "http" },
        { category: "custom", level: "error", timestamp: 1235 },
      ]);
      expect(event.message).toBe("safe error");
      expect(JSON.stringify(event)).not.toContain("synthetic-");
    }
  });
});
