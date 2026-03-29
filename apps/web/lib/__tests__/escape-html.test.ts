import { describe, it, expect } from "bun:test";
import { escapeHtml, sanitizeUrl } from "@/lib/html";

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes angle brackets", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('" onmouseover="alert(1)"')).toBe(
      "&quot; onmouseover=&quot;alert(1)&quot;",
    );
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("it's a test")).toBe("it&#x27;s a test");
  });

  it("escapes all special characters together", () => {
    expect(escapeHtml('<img src="x" onerror=\'alert(1)\'>&')).toBe(
      "&lt;img src=&quot;x&quot; onerror=&#x27;alert(1)&#x27;&gt;&amp;",
    );
  });

  it("returns plain text unchanged", () => {
    expect(escapeHtml("Hello World 123")).toBe("Hello World 123");
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("handles realistic PR title with XSS attempt", () => {
    const malicious = 'fix: update <iframe src="evil.com"> handler';
    expect(escapeHtml(malicious)).toBe(
      "fix: update &lt;iframe src=&quot;evil.com&quot;&gt; handler",
    );
  });
});

describe("sanitizeUrl", () => {
  it("allows https URLs", () => {
    expect(sanitizeUrl("https://github.com/org/repo/pull/1")).toBe(
      "https://github.com/org/repo/pull/1",
    );
  });

  it("allows http URLs", () => {
    expect(sanitizeUrl("http://example.com")).toBe("http://example.com");
  });

  it("blocks javascript: URLs", () => {
    expect(sanitizeUrl("javascript:alert(document.cookie)")).toBe("#");
  });

  it("blocks data: URLs", () => {
    expect(sanitizeUrl("data:text/html,<script>alert(1)</script>")).toBe("#");
  });

  it("returns # for invalid URLs", () => {
    expect(sanitizeUrl("not a url")).toBe("#");
  });

  it("returns # for empty string", () => {
    expect(sanitizeUrl("")).toBe("#");
  });
});
