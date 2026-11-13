import { describe, it, expect, mock } from "bun:test";

mock.module("server-only", () => ({}));

// Mock the db module before importing cost.ts (which imports prisma at top level).
// Bun's module mocks are file-scoped and automatically cleaned up — no manual restore needed.
mock.module("@octopus/db", () => ({
  prisma: {},
}));

const { calcCost, formatUsd, formatNumber, fallbackPricedModels } = await import("@/lib/cost");

// The cache-write premium tracks PROMPT_CACHE_TTL (1.25x for 5m, 2x for 1h).
// Pin 5m so the formula assertions below stay deterministic; a dedicated test
// covers the 1h (2x) default.
process.env.PROMPT_CACHE_TTL = "5m";

describe("calcCost", () => {
  const pricing = new Map<string, { input: number; output: number }>([
    ["claude-sonnet-4-20250514", { input: 3, output: 15 }],
    ["claude-opus-4-20250514", { input: 15, output: 75 }],
    ["gpt-4o", { input: 2.5, output: 10 }],
    ["text-embedding-3-large", { input: 0.13, output: 0 }],
  ]);

  it("returns 0 for unknown model", () => {
    const cost = calcCost(pricing, "unknown-model", 1000, 500, 0, 0);
    expect(cost).toBe(0);
  });

  it("calculates basic cost with no cache tokens", () => {
    // 1000 input tokens at $3/M, 500 output tokens at $15/M, 1.2x markup
    // (1000 * 3 + 500 * 15) / 1_000_000 * 1.2
    // = (3000 + 7500) / 1_000_000 * 1.2
    // = 0.0105 * 1.2 = 0.0126
    const cost = calcCost(pricing, "claude-sonnet-4-20250514", 1000, 500, 0, 0);
    expect(cost).toBeCloseTo(0.0126, 4);
  });

  it("applies cache read discount (0.1x input price)", () => {
    // 1000 input, 200 cache read, 0 cache write, 500 output
    // plainInput = max(1000 - 200 - 0, 0) = 800
    // baseCost = (800 * 3 + 0 * 3 * 1.25 + 200 * 3 * 0.1 + 500 * 15) / 1M
    //          = (2400 + 0 + 60 + 7500) / 1M = 0.00996
    // cost = 0.00996 * 1.2 = 0.011952
    const cost = calcCost(pricing, "claude-sonnet-4-20250514", 1000, 500, 200, 0);
    expect(cost).toBeCloseTo(0.011952, 5);
  });

  it("applies cache write premium (1.25x input price)", () => {
    // 1000 input, 0 cache read, 300 cache write, 500 output
    // plainInput = max(1000 - 0 - 300, 0) = 700
    // baseCost = (700 * 3 + 300 * 3 * 1.25 + 0 + 500 * 15) / 1M
    //          = (2100 + 1125 + 7500) / 1M = 0.010725
    // cost = 0.010725 * 1.2 = 0.01287
    const cost = calcCost(pricing, "claude-sonnet-4-20250514", 1000, 500, 0, 300);
    expect(cost).toBeCloseTo(0.01287, 5);
  });

  it("handles both cache read and write", () => {
    // 2000 input, 500 cache read, 300 cache write, 1000 output
    // plainInput = max(2000 - 500 - 300, 0) = 1200
    // baseCost = (1200 * 3 + 300 * 3 * 1.25 + 500 * 3 * 0.1 + 1000 * 15) / 1M
    //          = (3600 + 1125 + 150 + 15000) / 1M = 0.019875
    // cost = 0.019875 * 1.2 = 0.02385
    const cost = calcCost(pricing, "claude-sonnet-4-20250514", 2000, 1000, 500, 300);
    expect(cost).toBeCloseTo(0.02385, 5);
  });

  it("clamps plainInput to 0 when cache tokens exceed input tokens", () => {
    // 100 input, 80 cache read, 50 cache write → plainInput = max(100-80-50, 0) = 0
    const cost = calcCost(pricing, "claude-sonnet-4-20250514", 100, 50, 80, 50);
    // baseCost = (0 + 50 * 3 * 1.25 + 80 * 3 * 0.1 + 50 * 15) / 1M
    //          = (0 + 187.5 + 24 + 750) / 1M = 0.0009615
    // cost = 0.0009615 * 1.2 = 0.001_153_8
    expect(cost).toBeCloseTo(0.0011538, 5);
  });

  it("uses the 2x cache-write premium under the 1h TTL default", () => {
    const prev = process.env.PROMPT_CACHE_TTL;
    process.env.PROMPT_CACHE_TTL = "1h";
    try {
      // plainInput = 700; (700*3 + 300*3*2 + 500*15)/1M = (2100 + 1800 + 7500)/1M
      //            = 0.0114; * 1.2 markup = 0.01368
      const cost = calcCost(pricing, "claude-sonnet-4-20250514", 1000, 500, 0, 300);
      expect(cost).toBeCloseTo(0.01368, 5);
    } finally {
      process.env.PROMPT_CACHE_TTL = prev;
    }
  });

  it("works with embedding model (output price = 0)", () => {
    const cost = calcCost(pricing, "text-embedding-3-large", 10000, 0, 0, 0);
    // (10000 * 0.13) / 1M * 1.2 = 1300 / 1M * 1.2 = 0.00156
    expect(cost).toBeCloseTo(0.00156, 5);
  });

  it("returns 0 for zero tokens", () => {
    // 0 tokens * any price = 0, markup (1.2x) is irrelevant on zero base cost
    const cost = calcCost(pricing, "claude-sonnet-4-20250514", 0, 0, 0, 0);
    expect(cost).toBe(0);
  });

  it("includes 20% platform markup", () => {
    const costWithMarkup = calcCost(pricing, "gpt-4o", 1000, 1000, 0, 0);
    // baseCost = (1000 * 2.5 + 1000 * 10) / 1M = 0.0125
    // withMarkup = 0.0125 * 1.2 = 0.015
    expect(costWithMarkup).toBeCloseTo(0.015, 5);
  });
});

describe("formatUsd", () => {
  it("formats small amounts with 4 decimal places", () => {
    expect(formatUsd(0.001)).toBe("$0.0010");
    expect(formatUsd(0.0001)).toBe("$0.0001");
    expect(formatUsd(0.009)).toBe("$0.0090");
  });

  it("formats values at the 0.01 boundary correctly", () => {
    // Values < 0.01 get 4 decimal places, values >= 0.01 get 2
    expect(formatUsd(0.0099)).toBe("$0.0099"); // just below → 4 decimals
    expect(formatUsd(0.01)).toBe("$0.01"); // exactly at boundary → 2 decimals
    expect(formatUsd(0.011)).toBe("$0.01"); // just above → 2 decimals (truncated)
  });

  it("formats regular amounts with 2 decimal places", () => {
    expect(formatUsd(1.50)).toBe("$1.50");
    expect(formatUsd(0.10)).toBe("$0.10");
    expect(formatUsd(99.99)).toBe("$99.99");
  });

  it("formats zero", () => {
    expect(formatUsd(0)).toBe("$0.0000");
  });

  it("formats large amounts", () => {
    expect(formatUsd(1234.56)).toBe("$1234.56");
  });
});

describe("formatNumber", () => {
  it("formats millions", () => {
    expect(formatNumber(1_000_000)).toBe("1.0M");
    expect(formatNumber(2_500_000)).toBe("2.5M");
    expect(formatNumber(10_000_000)).toBe("10.0M");
  });

  it("formats thousands", () => {
    expect(formatNumber(1_000)).toBe("1.0K");
    expect(formatNumber(2_500)).toBe("2.5K");
    expect(formatNumber(500_000)).toBe("500.0K");
  });

  it("formats small numbers with locale string", () => {
    expect(formatNumber(42)).toBe((42).toLocaleString());
  });

  it("formats zero", () => {
    expect(formatNumber(0)).toBe((0).toLocaleString());
  });
});

it("prices Opus 5.5 cache reads at published $0.20 per million before markup", () => {
  const rates = new Map([["claude-opus-5-5", { input: 4, output: 20 }]]);
  expect(calcCost(rates, "claude-opus-5-5", 1_000_000, 0, 1_000_000, 0)).toBeCloseTo(0.20 * 1.2, 8);
});

it("prices Sonnet 5.5 input, output and both cache TTLs with platform markup", () => {
  expect(fallbackPricedModels()).toContain("claude-sonnet-5-5");
  const rates = new Map([["claude-sonnet-5-5", { input: 2, output: 10 }]]);
  // Anthropic input excludes cached reads/writes; each count is billed once.
  expect(calcCost(rates, "claude-sonnet-5-5", 1_000_000, 1_000_000, 1_000_000, 1_000_000, "anthropic", "5m"))
    .toBeCloseTo((2 + 10 + 0.20 + 2.50) * 1.2, 8);
  expect(calcCost(rates, "claude-sonnet-5-5", 1_000_000, 1_000_000, 1_000_000, 1_000_000, "anthropic", "1h"))
    .toBeCloseTo((2 + 10 + 0.20 + 4) * 1.2, 8);
});


describe("provider-native cache accounting", () => {
  it("keeps Anthropic uncached input and inclusive gateway input distinct", () => {
    const prices = new Map([["claude-opus-5-5", { input: 4, output: 20 }]]);
    expect(calcCost(prices, "claude-opus-5-5", 1000, 0, 10000, 0, "anthropic")).toBeCloseTo(.006 * 1.2, 10);
    expect(calcCost(prices, "claude-opus-5-5", 11000, 0, 10000, 0, "openrouter")).toBeCloseTo(.006 * 1.2, 10);
  });
  it("prices Fable 5.1 reads and simultaneous writes without double subtraction", () => {
    const prices = new Map([["claude-fable-5-1", { input: 10, output: 50 }]]);
    expect(calcCost(prices, "claude-fable-5-1", 1000, 100, 10000, 2000, "anthropic")).toBeCloseTo(.0425 * 1.2, 10);
  });
  it("gives Fable 5.2 the published $0.20/M cache read, not the ordinary tenth-of-input rate", () => {
    const prices = new Map([["claude-fable-5-2", { input: 8, output: 40 }], ["claude-fable-5", { input: 10, output: 50 }]]);
    // 1M cache-read tokens: 5.2 bills 2.5% of $8; Fable 5 keeps the default 10% of $10.
    expect(calcCost(prices, "claude-fable-5-2", 0, 0, 1_000_000, 0, "anthropic")).toBeCloseTo(0.20 * 1.2, 10);
    expect(calcCost(prices, "claude-fable-5", 0, 0, 1_000_000, 0, "anthropic")).toBeCloseTo(1.00 * 1.2, 10);
    expect(calcCost(prices, "claude-fable-5-2", 1_000_000, 1_000_000, 0, 0, "anthropic")).toBeCloseTo(48 * 1.2, 10);
  });
});

it("uses published older OpenAI cached-input rates without changing other providers", () => {
  for (const [alias, date, multiplier] of [
    ["gpt-4o", "2024-08-06", .5], ["gpt-4o-mini", "2024-07-18", .5],
    ["gpt-4.5-preview", "2025-02-27", .5],
    ["o1", "2024-12-17", .5], ["o1-mini", "2024-09-12", .5], ["o1-preview", "2024-09-12", .5],
    ["o3-mini", "2025-01-31", .5],
    ["gpt-4.1", "2025-04-14", .25], ["gpt-4.1-mini", "2025-04-14", .25], ["gpt-4.1-nano", "2025-04-14", .25],
    ["o3", "2025-04-16", .25], ["o4-mini", "2025-04-16", .25],
    ["o3-deep-research", "2025-06-26", .25], ["o4-mini-deep-research", "2025-06-26", .25],
  ] as const) {
    for (const model of [alias, `${alias}-${date}`]) {
      const prices = new Map([[model, { input: 10, output: 0 }]]);
      expect(calcCost(prices, model, 1000, 0, 1000, 0, "openai")).toBeCloseTo(.01 * multiplier * 1.2, 10);
      expect(calcCost(prices, model, 1000, 0, 1000, 0, "openrouter")).toBeCloseTo(.001 * 1.2, 10);
    }
  }
});

it("does not extend OpenAI rate exceptions to unrelated model names", () => {
  for (const model of ["gpt-5.3-codex", "gpt-6-astra", "o1-custom", "o3-mini-custom", "o4-mini-custom", "gpt-4.1-custom"]) {
    const prices = new Map([[model, { input: 10, output: 0 }]]);
    expect(calcCost(prices, model, 1000, 0, 1000, 0, "openai")).toBeCloseTo(.001 * 1.2, 10);
  }
});

it("settles Anthropic writes using the request TTL while historical estimates use deployment TTL", () => {
  const previous = process.env.PROMPT_CACHE_TTL;
  const prices = new Map([["claude-opus-5-5", { input: 4, output: 20 }]]);
  try {
    for (const ttl of ["5m", "1h"] as const) {
      process.env.PROMPT_CACHE_TTL = ttl;
      expect(calcCost(prices, "claude-opus-5-5", 0, 0, 0, 1000, "anthropic", "5m")).toBeCloseTo(.005 * 1.2, 10);
      expect(calcCost(prices, "claude-opus-5-5", 0, 0, 0, 1000, "anthropic", "1h")).toBeCloseTo(.008 * 1.2, 10);
      expect(calcCost(prices, "claude-opus-5-5", 0, 0, 0, 1000, "anthropic")).toBeCloseTo((ttl === "5m" ? .005 : .008) * 1.2, 10);
      expect(calcCost(prices, "claude-opus-5-5", 1000, 0, 0, 1000, "openrouter", "5m")).toBeCloseTo((ttl === "5m" ? .005 : .008) * 1.2, 10);
    }
  } finally {
    if (previous === undefined) delete process.env.PROMPT_CACHE_TTL;
    else process.env.PROMPT_CACHE_TTL = previous;
  }
});
