import { describe, expect, it } from "bun:test";
import { concurrencyGuardApplies } from "@/lib/cost";

describe("concurrencyGuardApplies (#506 low-balance guard)", () => {
  it("never guards a fully-BYOK org (no platform spend)", () => {
    expect(concurrencyGuardApplies(true, 5)).toBe(false);
    expect(concurrencyGuardApplies(true, 0.5)).toBe(false);
  });

  it("guards a platform-billed org only inside the (0, threshold) window", () => {
    expect(concurrencyGuardApplies(false, 5)).toBe(true); // low → serialize
    expect(concurrencyGuardApplies(false, 9.99)).toBe(true);
    expect(concurrencyGuardApplies(false, 10)).toBe(false); // comfortable → no cap
    expect(concurrencyGuardApplies(false, 100)).toBe(false);
  });

  it("does not guard at or below zero — the spend-limit block already handles that", () => {
    expect(concurrencyGuardApplies(false, 0)).toBe(false);
    expect(concurrencyGuardApplies(false, -1)).toBe(false);
  });
});
