import { describe, it, expect } from "bun:test";
import { defaultModelFor, formatPrice, modelsFor, MODELS_BY_PROVIDER } from "../lib/models";

describe("modelsFor", () => {
  it("returns the catalogue for a known provider", () => {
    const models = modelsFor("anthropic");
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.modelId.length > 0)).toBe(true);
  });

  it("returns [] for an unknown provider", () => {
    expect(modelsFor("nonexistent")).toEqual([]);
  });

  it("returns [] for coming-soon providers (until backend seeds them)", () => {
    expect(modelsFor("ollama")).toEqual([]);
    expect(modelsFor("openrouter")).toEqual([]);
    expect(modelsFor("claude-code")).toEqual([]);
  });
});

describe("defaultModelFor", () => {
  it("returns the isDefault model when one is marked", () => {
    expect(defaultModelFor("anthropic")?.modelId).toBe("claude-sonnet-4-6");
    expect(defaultModelFor("openai")?.modelId).toBe("gpt-4o");
    expect(defaultModelFor("google")?.modelId).toBe("gemini-2.5-pro");
  });

  it("returns null for an empty catalogue", () => {
    expect(defaultModelFor("ollama")).toBeNull();
  });
});

describe("MODELS_BY_PROVIDER invariants", () => {
  it("every model has unique modelId within its provider", () => {
    for (const [provider, models] of Object.entries(MODELS_BY_PROVIDER)) {
      const ids = models.map((m) => m.modelId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("at most one default per provider", () => {
    for (const [provider, models] of Object.entries(MODELS_BY_PROVIDER)) {
      const defaults = models.filter((m) => m.isDefault);
      expect(defaults.length).toBeLessThanOrEqual(1);
    }
  });

  it("prices are non-negative", () => {
    for (const models of Object.values(MODELS_BY_PROVIDER)) {
      for (const m of models) {
        expect(m.inputPrice).toBeGreaterThanOrEqual(0);
        expect(m.outputPrice).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("formatPrice", () => {
  it("renders whole-dollar prices without decimals", () => {
    expect(formatPrice({ modelId: "x", displayName: "x", inputPrice: 3, outputPrice: 15 })).toBe(
      "$3 / $15 per 1M",
    );
  });

  it("renders sub-dollar prices with trailing-zero trim", () => {
    expect(formatPrice({ modelId: "x", displayName: "x", inputPrice: 0.15, outputPrice: 0.6 })).toBe(
      "$0.15 / $0.6 per 1M",
    );
  });
});
