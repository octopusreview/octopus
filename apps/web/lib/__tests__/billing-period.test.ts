import { describe, expect, it } from "bun:test";
import {
  formatBillingResetLabel,
  getAutoReloadDisplayStatus,
  getUtcMonthBounds,
  summarizeMonthlySpend,
} from "@/lib/billing-period";

describe("auto-reload display status", () => {
  it("prioritizes a rollout pause over the saved enabled flag", () => {
    expect(getAutoReloadDisplayStatus(true, true)).toBe("paused");
  });

  it("shows active and inactive persisted states", () => {
    expect(getAutoReloadDisplayStatus(true, false)).toBe("on");
    expect(getAutoReloadDisplayStatus(false, false)).toBe("off");
  });
});

describe("billing period", () => {
  it("returns UTC month boundaries across a year boundary", () => {
    const { start, end } = getUtcMonthBounds(
      new Date("2026-12-31T23:59:59.999Z"),
    );

    expect(start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(formatBillingResetLabel(end)).toBe("Jan 1");
  });
});

describe("monthly spend summary", () => {
  it("represents an unlimited month without progress or remaining values", () => {
    expect(summarizeMonthlySpend(12.5, null)).toEqual({
      spendUsd: 12.5,
      limitUsd: null,
      remainingUsd: null,
      percentUsed: null,
      progressPercent: null,
      limitReached: false,
    });
  });

  it("calculates remaining spend and progress below the limit", () => {
    expect(summarizeMonthlySpend(25, 100)).toEqual({
      spendUsd: 25,
      limitUsd: 100,
      remainingUsd: 75,
      percentUsed: 25,
      progressPercent: 25,
      limitReached: false,
    });
  });

  it("caps visual progress while preserving the true over-limit percentage", () => {
    expect(summarizeMonthlySpend(125, 100)).toEqual({
      spendUsd: 125,
      limitUsd: 100,
      remainingUsd: 0,
      percentUsed: 125,
      progressPercent: 100,
      limitReached: true,
    });
  });

  it("treats a zero limit as reached even before usage", () => {
    expect(summarizeMonthlySpend(0, 0)).toEqual({
      spendUsd: 0,
      limitUsd: 0,
      remainingUsd: 0,
      percentUsed: 100,
      progressPercent: 100,
      limitReached: true,
    });
  });
});
