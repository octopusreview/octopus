import { describe, expect, it } from "bun:test";
import { shouldFailReviewCheck } from "@/lib/review-helpers";

const sev = (hasCritical: boolean, hasHigh: boolean, hasMedium: boolean) => ({
  hasCritical,
  hasHigh,
  hasMedium,
});

describe("shouldFailReviewCheck (merge-gating decision)", () => {
  it("never fails when threshold is 'none', regardless of severity", () => {
    expect(shouldFailReviewCheck(sev(true, true, true), "none")).toBe(false);
  });

  it("'critical' fails only on a critical finding", () => {
    expect(shouldFailReviewCheck(sev(true, false, false), "critical")).toBe(true);
    expect(shouldFailReviewCheck(sev(false, true, true), "critical")).toBe(false);
    expect(shouldFailReviewCheck(sev(false, false, false), "critical")).toBe(false);
  });

  it("'high' fails on critical or high, not medium-only", () => {
    expect(shouldFailReviewCheck(sev(true, false, false), "high")).toBe(true);
    expect(shouldFailReviewCheck(sev(false, true, false), "high")).toBe(true);
    expect(shouldFailReviewCheck(sev(false, false, true), "high")).toBe(false);
  });

  it("'medium' fails on any of critical/high/medium", () => {
    expect(shouldFailReviewCheck(sev(false, false, true), "medium")).toBe(true);
    expect(shouldFailReviewCheck(sev(false, true, false), "medium")).toBe(true);
    expect(shouldFailReviewCheck(sev(true, false, false), "medium")).toBe(true);
    expect(shouldFailReviewCheck(sev(false, false, false), "medium")).toBe(false);
  });
});
