import { describe, expect, it } from "bun:test";
import { githubRateWindow } from "@/lib/github-rate-window";

const now = Date.parse("2026-01-01T12:00:00Z");
const response = (status: number, headers: Record<string, string>) => new Response(null, { status, headers });

describe("GitHub rate-limit response windows", () => {
  it("honors a primary reset even when Retry-After is shorter", () => {
    const reset = Math.floor(now / 1000) + 3600;
    expect(githubRateWindow(response(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset), "retry-after": "5" }), now))
      .toEqual({ kind: "primary", notBefore: reset * 1000 });
  });

  it("does not ignore an exhausted quota on a successful response", () => {
    const reset = Math.floor(now / 1000) + 90;
    expect(githubRateWindow(response(200, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) }), now))
      .toEqual({ kind: "primary", notBefore: reset * 1000 });
  });

  it("does not retry early when the local clock is ahead of GitHub", () => {
    const serverDate = now - 120_000;
    const reset = Math.floor((serverDate + 600_000) / 1000);
    expect(githubRateWindow(response(403, { date: new Date(serverDate).toUTCString(), "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) }), now))
      .toEqual({ kind: "primary", notBefore: now + 600_000 });
  });

  it("is conservative when the local clock is behind GitHub", () => {
    const serverDate = now + 120_000;
    const reset = Math.floor((serverDate + 600_000) / 1000);
    expect(githubRateWindow(response(403, { date: new Date(serverDate).toUTCString(), "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) }), now))
      .toEqual({ kind: "primary", notBefore: reset * 1000 });
  });

  it("does not invent a reset when the primary reset header is missing or invalid", () => {
    for (const reset of [undefined, "not-a-time", "999999999999999999999", String(Math.floor(now / 1000) - 1)]) {
      const headers: Record<string, string> = { "x-ratelimit-remaining": "0", "retry-after": "5" };
      if (reset !== undefined) headers["x-ratelimit-reset"] = reset;
      expect(githubRateWindow(response(403, headers), now)).toEqual({ kind: "primary", notBefore: null });
    }
  });

  it("honors explicit retry guidance and backs off on unqualified 429s", () => {
    expect(githubRateWindow(response(403, { "retry-after": "90" }), now)).toEqual({ kind: "retry-after", notBefore: now + 90_000 });
    expect(githubRateWindow(response(429, {}), now)).toEqual({ kind: "throttled", notBefore: now + 60_000 });
    expect(githubRateWindow(response(429, { "retry-after": "-1" }), now)).toEqual({ kind: "retry-after", notBefore: null });
    expect(githubRateWindow(response(403, { "retry-after": "invalid" }), now)).toEqual({ kind: "retry-after", notBefore: null });
    expect(githubRateWindow(response(429, { "retry-after": "0" }), now)).toEqual({ kind: "retry-after", notBefore: now + 1000 });
    expect(githubRateWindow(response(429, { "retry-after": new Date(now + 120_000).toUTCString() }), now)).toEqual({ kind: "retry-after", notBefore: now + 120_000 });
  });

  it("does not classify an unmarked 403 as either a permission or rate-limit failure", () => {
    expect(githubRateWindow(response(403, {}), now)).toBeNull();
    expect(githubRateWindow(response(500, { "retry-after": "20" }), now)).toBeNull();
  });
});
