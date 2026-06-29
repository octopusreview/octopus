import { describe, it, expect } from "bun:test";
import { PROVIDERS, providersByType } from "../lib/providers";

describe("PROVIDERS catalogue", () => {
  it("every provider has a unique slug", () => {
    const slugs = PROVIDERS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("ready providers cover the three direct vendors", () => {
    const ready = PROVIDERS.filter((p) => p.status === "ready").map((p) => p.slug);
    expect(ready).toContain("anthropic");
    expect(ready).toContain("openai");
    expect(ready).toContain("google");
  });

  it("every provider has displayName and blurb populated", () => {
    for (const p of PROVIDERS) {
      expect(p.displayName.length).toBeGreaterThan(0);
      expect(p.blurb.length).toBeGreaterThan(0);
    }
  });
});

describe("providersByType", () => {
  it("returns only direct providers for 'direct'", () => {
    for (const p of providersByType("direct")) expect(p.type).toBe("direct");
  });

  it("returns harnesses including claude-code + codex + opencode", () => {
    const slugs = providersByType("harness").map((p) => p.slug);
    expect(slugs).toContain("claude-code");
    expect(slugs).toContain("codex");
    expect(slugs).toContain("opencode");
  });

  it("returns gateways including openrouter + acp", () => {
    const slugs = providersByType("gateway").map((p) => p.slug);
    expect(slugs).toContain("openrouter");
    expect(slugs).toContain("acp");
  });

  it("returns local including ollama", () => {
    expect(providersByType("local").map((p) => p.slug)).toContain("ollama");
  });
});
