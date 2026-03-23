import { describe, it, expect, mock } from "bun:test";

// Mock the db module before importing cost.ts (which imports prisma at top level)
mock.module("@octopus/db", () => ({
  prisma: {},
}));

import { calcCost, formatUsd, formatNumber } from "@/lib/cost";

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

  it("works with embedding model (output price = 0)", () => {
    const cost = calcCost(pricing, "text-embedding-3-large", 10000, 0, 0, 0);
    // (10000 * 0.13) / 1M * 1.2 = 1300 / 1M * 1.2 = 0.00156
    expect(cost).toBeCloseTo(0.00156, 5);
  });

  it("returns 0 for zero tokens", () => {
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

  it("formats regular amounts with 2 decimal places", () => {
    expect(formatUsd(1.50)).toBe("$1.50");
    expect(formatUsd(0.01)).toBe("$0.01");
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
    expect(formatNumber(999_999)).toBe("1000.0K");
  });

  it("formats small numbers with locale string", () => {
    const result = formatNumber(42);
    expect(result).toBe("42");
  });

  it("formats zero", () => {
    expect(formatNumber(0)).toBe("0");
  });
});
