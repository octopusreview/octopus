import { describe, it, expect } from "bun:test";
import { PROVIDERS, buildProviderItems, defaultProvider, displayNameFor, providersByType } from "../lib/providers";

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
    expect(ready).toContain("alibaba");
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

describe("defaultProvider / displayNameFor", () => {
  it("recommends a ready direct-API provider", () => {
    const p = defaultProvider();
    expect(p?.slug).toBe("anthropic");
    expect(p?.status).toBe("ready");
  });

  it("names known slugs and falls back to the slug for stale ones", () => {
    expect(displayNameFor("anthropic")).toBe("Claude (Anthropic)");
    expect(displayNameFor("no-such-provider")).toBe("no-such-provider");
  });
});

describe("buildProviderItems", () => {
  it("never lists coming-soon providers", () => {
    for (const cloud of [true, false]) {
      const values = buildProviderItems(PROVIDERS, { cloud }).map((i) => i.value);
      for (const p of PROVIDERS.filter((p) => p.status === "coming-soon")) expect(values).not.toContain(p.slug);
      expect(values.some((v) => v.startsWith("__heading_"))).toBe(false);
    }
  });

  it("hides local providers on Cloud and shows them for self-hosted", () => {
    expect(buildProviderItems(PROVIDERS, { cloud: true }).map((i) => i.value)).not.toContain("ollama");
    expect(buildProviderItems(PROVIDERS, { cloud: false }).map((i) => i.value)).toContain("ollama");
  });

  it("keeps catalogue order and human labels", () => {
    const items = buildProviderItems(PROVIDERS, { cloud: true });
    expect(items[0]).toEqual({ label: "Claude (Anthropic)", value: "anthropic" });
    expect(items.map((i) => i.value)).toEqual(["anthropic", "openai", "google", "alibaba"]);
  });
});
