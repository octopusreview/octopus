import { describe, it, expect } from "bun:test";
import {
  computeLabelMetrics,
  computeRecall,
  diffAgainstBaseline,
  labelSufficiencyWarnings,
  type FeedbackLabel,
  type EvalReport,
} from "@/lib/review-eval";

const L = (severity: string, feedback: "up" | "down", confidence: string | null = "HIGH"): FeedbackLabel => ({
  severity,
  confidence,
  feedback,
});

describe("computeLabelMetrics", () => {
  it("computes precision and fp-rate overall and by bucket", () => {
    const labels = [
      L("high", "up"),
      L("high", "up"),
      L("high", "down"),
      L("low", "down"),
    ];
    const m = computeLabelMetrics(labels);
    expect(m.overall).toMatchObject({ n: 4, up: 2, down: 2, precision: 0.5, fpRate: 0.5 });
    expect(m.bySeverity.high).toMatchObject({ n: 3, precision: 2 / 3 });
    expect(m.bySeverity.low).toMatchObject({ n: 1, precision: 0, fpRate: 1 });
  });

  it("returns null precision/fpRate for empty input, never divides by zero", () => {
    const m = computeLabelMetrics([]);
    expect(m.overall).toMatchObject({ n: 0, precision: null, fpRate: null });
  });

  it("buckets null confidence under 'unset'", () => {
    const m = computeLabelMetrics([L("high", "up", null)]);
    expect(m.byConfidence.unset.n).toBe(1);
  });
});

describe("computeRecall", () => {
  it("is null when there are no fixtures (never fabricates recall)", () => {
    expect(computeRecall([]).recall).toBeNull();
  });

  it("computes matched/expected across fixtures", () => {
    const r = computeRecall([
      { name: "a", expected: ["s1", "s2"], reported: ["s1", "s9"] },
      { name: "b", expected: ["s3"], reported: ["s3"] },
    ]);
    expect(r.matched).toBe(2);
    expect(r.expected).toBe(3);
    expect(r.recall).toBeCloseTo(2 / 3);
    expect(r.byFixture[0]).toMatchObject({ name: "a", matched: 1, expected: 2, recall: 0.5 });
  });
});

describe("labelSufficiencyWarnings", () => {
  it("warns when the overall label count is below the significance floor", () => {
    const m = computeLabelMetrics([L("high", "up"), L("high", "down")]);
    const w = labelSufficiencyWarnings(m);
    expect(w.some((x) => x.includes("overall") || x.includes("Only 2"))).toBe(true);
  });
});

describe("diffAgainstBaseline", () => {
  const mk = (precision: number, fpRate: number, recall: number | null = null): EvalReport => ({
    generatedAt: "2026-07-24",
    labels: {
      overall: { n: 100, up: 0, down: 0, precision, fpRate },
      bySeverity: {},
      byConfidence: {},
    },
    recall: { recall, matched: 0, expected: 0, byFixture: [] },
    warnings: [],
  });

  it("flags a precision drop beyond tolerance", () => {
    const regs = diffAgainstBaseline(mk(0.7, 0.3), mk(0.9, 0.3), 0.05);
    expect(regs.some((r) => r.scope === "overall" && r.metric === "precision")).toBe(true);
  });

  it("flags an fp-rate rise beyond tolerance", () => {
    const regs = diffAgainstBaseline(mk(0.9, 0.5), mk(0.9, 0.3), 0.05);
    expect(regs.some((r) => r.metric === "fpRate")).toBe(true);
  });

  it("does not flag improvements or within-tolerance drift", () => {
    expect(diffAgainstBaseline(mk(0.92, 0.28), mk(0.9, 0.3), 0.05)).toHaveLength(0);
    expect(diffAgainstBaseline(mk(0.87, 0.32), mk(0.9, 0.3), 0.05)).toHaveLength(0);
  });

  it("skips comparison when a metric is null on either side", () => {
    expect(diffAgainstBaseline(mk(0.9, 0.3, null), mk(0.9, 0.3, 0.8), 0.05)).toHaveLength(0);
  });
});
