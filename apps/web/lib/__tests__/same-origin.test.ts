import { describe, it, expect, afterEach } from "bun:test";
import { isSameOrigin } from "@/lib/same-origin";

const ORIG_AUTH = process.env.BETTER_AUTH_URL;
const ORIG_APP = process.env.NEXT_PUBLIC_APP_URL;

function setCanonical(url: string | undefined) {
  if (url === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = url;
  delete process.env.NEXT_PUBLIC_APP_URL;
}

afterEach(() => {
  if (ORIG_AUTH === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = ORIG_AUTH;
  if (ORIG_APP === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = ORIG_APP;
});

describe("isSameOrigin", () => {
  it("accepts an Origin matching the canonical host even when Host is a rewritten internal value (proxy case)", () => {
    setCanonical("https://octopus-review.ai");
    // The proxy rewrote Host to an internal service name; the browser Origin
    // still matches our canonical domain, so this must pass.
    expect(isSameOrigin("web:3000", "https://octopus-review.ai", null)).toBe(true);
  });

  it("rejects a cross-site Origin", () => {
    setCanonical("https://octopus-review.ai");
    expect(isSameOrigin("web:3000", "https://evil.com", null)).toBe(false);
  });

  it("falls back to Referer when no Origin is present", () => {
    setCanonical("https://octopus-review.ai");
    expect(isSameOrigin("web:3000", null, "https://octopus-review.ai/monitor")).toBe(true);
    expect(isSameOrigin("web:3000", null, "https://evil.com/x")).toBe(false);
  });

  it("rejects when neither Origin nor Referer is present", () => {
    setCanonical("https://octopus-review.ai");
    expect(isSameOrigin("octopus-review.ai", null, null)).toBe(false);
  });

  it("falls back to the request Host when no canonical URL is configured (self-host/dev)", () => {
    setCanonical(undefined);
    expect(isSameOrigin("localhost:3000", "http://localhost:3000", null)).toBe(true);
    expect(isSameOrigin("localhost:3000", "http://evil.com", null)).toBe(false);
  });

  it("rejects when there is neither a canonical URL nor a Host header", () => {
    setCanonical(undefined);
    expect(isSameOrigin(null, "https://octopus-review.ai", null)).toBe(false);
  });

  it("rejects a malformed Origin value", () => {
    setCanonical("https://octopus-review.ai");
    expect(isSameOrigin("octopus-review.ai", "not a url", null)).toBe(false);
  });
});
