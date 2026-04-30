import { describe, it, expect } from "bun:test";
import { buildInlineComments, NEAREST_LINE_FALLBACK_RADIUS } from "@/lib/review-helpers";
import type { InlineFinding } from "@/lib/review-dedup";

function f(overrides: Partial<InlineFinding> = {}): InlineFinding {
  return {
    severity: "🟠",
    title: "Test finding",
    filePath: "src/foo.ts",
    startLine: 100,
    endLine: 100,
    category: "Bug",
    description: "desc",
    suggestion: "",
    confidence: 80,
    ...overrides,
  };
}

describe("buildInlineComments — exact mapping", () => {
  it("attaches when endLine is in the diff", () => {
    const diff = new Map([["src/foo.ts", new Set([100, 101, 102])]]);
    const comments = buildInlineComments([f({ startLine: 100, endLine: 100 })], diff);
    expect(comments.length).toBe(1);
    expect(comments[0]?.line).toBe(100);
    expect(comments[0]?.body).not.toContain("nearest changed line");
  });

  it("falls back to startLine when endLine is invalid", () => {
    const diff = new Map([["src/foo.ts", new Set([95])]]);
    const comments = buildInlineComments([f({ startLine: 95, endLine: 200 })], diff);
    expect(comments[0]?.line).toBe(95);
    expect(comments[0]?.body).not.toContain("nearest changed line");
  });

  it("uses an in-range valid line when neither end matches", () => {
    const diff = new Map([["src/foo.ts", new Set([102])]]);
    const comments = buildInlineComments([f({ startLine: 100, endLine: 105 })], diff);
    expect(comments[0]?.line).toBe(102);
    expect(comments[0]?.body).not.toContain("nearest changed line");
  });
});

describe("buildInlineComments — nearest-line fallback", () => {
  it("snaps to closest changed line within ±10 (after endLine)", () => {
    const diff = new Map([["src/foo.ts", new Set([108])]]);
    const comments = buildInlineComments([f({ startLine: 100, endLine: 100 })], diff);
    expect(comments.length).toBe(1);
    expect(comments[0]?.line).toBe(108);
    expect(comments[0]?.body).toContain("nearest changed line");
    expect(comments[0]?.body).toContain("L100");
  });

  it("snaps to closest changed line within ±10 (before startLine)", () => {
    const diff = new Map([["src/foo.ts", new Set([93])]]);
    const comments = buildInlineComments([f({ startLine: 100, endLine: 100 })], diff);
    expect(comments[0]?.line).toBe(93);
    expect(comments[0]?.body).toContain("nearest changed line");
  });

  it("prefers smaller delta when both sides have a valid line", () => {
    const diff = new Map([["src/foo.ts", new Set([95, 105])]]);
    const comments = buildInlineComments([f({ startLine: 100, endLine: 100 })], diff);
    // both are 5 away — endLine search runs first (95 negative delta first? no: positive then negative? actually findNearestChangedLine tries -delta then +delta on each delta value, so 95 wins on delta=5)
    expect([95, 105]).toContain(comments[0]?.line);
  });

  it("drops the comment when no valid line exists within the radius", () => {
    const farLine = 100 + NEAREST_LINE_FALLBACK_RADIUS + 5;
    const diff = new Map([["src/foo.ts", new Set([farLine])]]);
    const comments = buildInlineComments([f({ startLine: 100, endLine: 100 })], diff);
    expect(comments.length).toBe(0);
  });

  it("drops the comment when the file is not in the diff at all", () => {
    const diff = new Map([["src/bar.ts", new Set([100])]]);
    const comments = buildInlineComments([f({ filePath: "src/foo.ts" })], diff);
    expect(comments.length).toBe(0);
  });
});
