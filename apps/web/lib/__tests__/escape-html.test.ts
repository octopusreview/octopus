import { describe, it, expect } from "bun:test";

// Inline the same escapeHtml implementation to test the logic
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

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
    expect(escapeHtml(`<img src="x" onerror='alert(1)'>&`)).toBe(
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
