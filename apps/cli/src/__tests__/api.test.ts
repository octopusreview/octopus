import { describe, it, expect } from "bun:test";
import { normalizeBaseUrl } from "../lib/api";

describe("normalizeBaseUrl", () => {
  it("strips trailing slashes", () => {
    expect(normalizeBaseUrl("https://example.com/")).toBe("https://example.com");
    expect(normalizeBaseUrl("https://example.com///")).toBe("https://example.com");
  });

  it("returns the origin (drops path and query)", () => {
    expect(normalizeBaseUrl("https://example.com/some/path?foo=bar")).toBe("https://example.com");
  });

  it("accepts http", () => {
    expect(normalizeBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("trims whitespace", () => {
    expect(normalizeBaseUrl("  https://example.com  ")).toBe("https://example.com");
  });

  it("returns null for empty input", () => {
    expect(normalizeBaseUrl("")).toBeNull();
    expect(normalizeBaseUrl("   ")).toBeNull();
  });

  it("returns null for non-http schemes", () => {
    expect(normalizeBaseUrl("ftp://example.com")).toBeNull();
    expect(normalizeBaseUrl("file:///tmp/x")).toBeNull();
    expect(normalizeBaseUrl("javascript:alert(1)")).toBeNull();
  });

  it("returns null for garbage", () => {
    expect(normalizeBaseUrl("not a url")).toBeNull();
    expect(normalizeBaseUrl("example.com")).toBeNull(); // no scheme
  });
});
