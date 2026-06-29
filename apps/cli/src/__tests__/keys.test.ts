import { describe, it, expect } from "bun:test";
import { hintFor, KEY_HINTS } from "../lib/keys";

describe("hintFor", () => {
  it("returns provider-specific hints for known providers", () => {
    expect(hintFor("anthropic").placeholder).toContain("sk-ant-");
    expect(hintFor("openai").placeholder).toContain("sk-");
    expect(hintFor("google").placeholder).toContain("AIza");
  });

  it("marks keyless providers", () => {
    expect(hintFor("ollama").keyless).toBe(true);
    expect(hintFor("claude-code").keyless).toBe(true);
    expect(hintFor("codex").keyless).toBe(true);
  });

  it("returns a generic fallback for unknown providers", () => {
    const h = hintFor("not-a-real-provider");
    expect(h.placeholder).toBe("API key…");
    expect(h.dashboardUrl).toBe("");
    expect(h.keyless).toBeUndefined();
  });
});

describe("KEY_HINTS invariants", () => {
  it("every entry has a placeholder", () => {
    for (const [provider, hint] of Object.entries(KEY_HINTS)) {
      expect(hint.placeholder.length).toBeGreaterThan(0);
    }
  });

  it("non-keyless entries link to a dashboard URL", () => {
    for (const [provider, hint] of Object.entries(KEY_HINTS)) {
      if (!hint.keyless) {
        expect(hint.dashboardUrl.length).toBeGreaterThan(0);
        expect(hint.dashboardUrl).toMatch(/^https?:\/\//);
      }
    }
  });

  it("keyless entries set minLength to 0", () => {
    for (const hint of Object.values(KEY_HINTS)) {
      if (hint.keyless) expect(hint.minLength).toBe(0);
    }
  });
});
