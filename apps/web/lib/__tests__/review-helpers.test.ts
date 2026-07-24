import { describe, it, expect } from "bun:test";
import { formatPastReviews, formatPrIntent, buildRetrievalQuery, cappedConfidence, UNCITED_HIGH_SEV_CAP, filterByConfidence, type PastReviewHit } from "@/lib/review-helpers";

describe("formatPastReviews", () => {
  const hit = (o: Partial<PastReviewHit> = {}): PastReviewHit => ({
    text: "Flagged an N+1 query in the loader.",
    prTitle: "Add loader",
    prNumber: 10,
    repoFullName: "org/repo",
    author: "alice",
    reviewDate: "2026-07-01T12:00:00.000Z",
    score: 0.8,
    ...o,
  });

  it("returns empty string when there are no hits", () => {
    expect(formatPastReviews([], 5, "org/repo")).toBe("");
  });

  it("excludes the current PR's own prior review", () => {
    const out = formatPastReviews([hit({ prNumber: 5, repoFullName: "org/repo" })], 5, "org/repo");
    expect(out).toBe("");
  });

  it("keeps a same-numbered PR from a different repo", () => {
    const out = formatPastReviews([hit({ prNumber: 5, repoFullName: "org/other" })], 5, "org/repo");
    expect(out).toContain("org/other#5");
  });

  it("drops low-score and empty-text hits", () => {
    expect(formatPastReviews([hit({ score: 0.1 })], 1, "org/repo")).toBe("");
    expect(formatPastReviews([hit({ text: "   " })], 1, "org/repo")).toBe("");
  });

  it("caps to max and truncates long bodies", () => {
    const many = Array.from({ length: 9 }, (_, i) => hit({ prNumber: 100 + i }));
    const out = formatPastReviews(many, 5, "org/repo", { max: 3 });
    expect(out.match(/^### /gm)?.length).toBe(3);
    const longOut = formatPastReviews([hit({ text: "x".repeat(2000) })], 5, "org/repo", { maxCharsPerHit: 50 });
    expect(longOut.includes("x".repeat(51))).toBe(false);
  });

  it("renders repo#pr — title with a date", () => {
    const out = formatPastReviews([hit()], 5, "org/repo");
    expect(out).toContain("### org/repo#10 — Add loader (2026-07-01)");
  });
});

describe("formatPrIntent", () => {
  it("returns empty when there is no title or body", () => {
    expect(formatPrIntent("", "")).toBe("");
    expect(formatPrIntent(null, null)).toBe("");
  });

  it("includes title and description", () => {
    const out = formatPrIntent("Add rate limiter", "Adds a token-bucket limiter to the API.");
    expect(out).toContain("Title: Add rate limiter");
    expect(out).toContain("Description:");
    expect(out).toContain("token-bucket");
  });

  it("extracts linked issues from closes/fixes and bare refs", () => {
    const out = formatPrIntent("x", "Fixes #12 and relates to #34. closes #12");
    const linkedLine = out.split("\n").find((l) => l.startsWith("Linked issues:")) ?? "";
    expect(linkedLine).toContain("#12");
    expect(linkedLine).toContain("#34");
    // deduped within the linked-issues list
    expect(linkedLine.match(/#12/g)?.length).toBe(1);
  });

  it("truncates a long body", () => {
    const out = formatPrIntent("t", "y".repeat(5000), { maxBodyChars: 100 });
    expect(out).toContain("…(truncated)");
    expect(out.includes("y".repeat(101))).toBe(false);
  });
});

describe("formatPrIntent parenthesised refs", () => {
  it("extracts refs wrapped in parens/brackets", () => {
    const out = formatPrIntent("t", "See (#42) and [#7].");
    const linked = out.split("\n").find((l) => l.startsWith("Linked issues:")) ?? "";
    expect(linked).toContain("#42");
    expect(linked).toContain("#7");
  });
});

describe("buildRetrievalQuery", () => {
  const bigDiff = Array.from({ length: 20 }, (_, i) =>
    `diff --git a/src/mod${i}/file${i}.ts b/src/mod${i}/file${i}.ts\n--- a/src/mod${i}/file${i}.ts\n+++ b/src/mod${i}/file${i}.ts\n@@ -1,3 +1,4 @@ export function handler${i}() {\n+  const paymentProcessor${i} = new Stripe();\n`,
  ).join("\n");

  it("includes later-file identifiers, not just the first ~8k chars", () => {
    const q = buildRetrievalQuery(bigDiff, "Refactor payments");
    // file19 appears well beyond 8000 chars of raw diff — must still be represented
    expect(q).toContain("Refactor payments");
    expect(q).toContain("file19.ts");
    expect(q).toContain("paymentProcessor19");
  });

  it("does NOT embed raw +/- diff markers", () => {
    const q = buildRetrievalQuery("diff --git a/a.ts b/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n+const payload = 1;\n", "t");
    expect(q.includes("+const")).toBe(false);
    expect(q.includes("+++")).toBe(false);
  });

  it("is bounded in size", () => {
    const q = buildRetrievalQuery(bigDiff, "t", { maxChars: 300 });
    expect(q.length).toBeLessThanOrEqual(300);
  });

  it("strips language keywords from identifiers", () => {
    const q = buildRetrievalQuery("+++ b/a.ts\n@@ @@\n+  const function return await;\n", "t");
    expect(q).not.toContain("const");
    expect(q).not.toContain("function");
  });
});

describe("cappedConfidence (adversarial validation #654)", () => {
  it("caps an uncited high-severity finding to the ceiling", () => {
    expect(cappedConfidence("🔴", 95, false)).toBe(UNCITED_HIGH_SEV_CAP);
    expect(cappedConfidence("🟠", 88, false)).toBe(UNCITED_HIGH_SEV_CAP);
  });
  it("does NOT cap a cited high-severity finding", () => {
    expect(cappedConfidence("🔴", 95, true)).toBe(95);
  });
  it("does NOT cap non-high severities", () => {
    expect(cappedConfidence("🟡", 95, false)).toBe(95);
    expect(cappedConfidence("🔵", 90, false)).toBe(90);
  });
  it("leaves an already-low uncited high-severity score untouched", () => {
    expect(cappedConfidence("🔴", 40, false)).toBe(40);
  });
});

describe("filterByConfidence (#652 shared filter)", () => {
  const f = (o: Partial<import("@/lib/review-dedup").InlineFinding>) => ({
    severity: "🟡", title: "t", description: "d", category: "Style",
    filePath: "a.ts", startLine: 1, endLine: 1, confidence: 80, ...o,
  }) as import("@/lib/review-dedup").InlineFinding;

  it("drops findings below the base threshold", () => {
    const out = filterByConfidence([f({ confidence: 80 }), f({ confidence: 50 })], 70);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe(80);
  });

  it("keeps a high-risk category at a relaxed threshold", () => {
    // Security is relaxed below the base 70, so a 60-confidence security finding survives.
    const out = filterByConfidence([f({ category: "Security", confidence: 60 })], 70);
    expect(out).toHaveLength(1);
  });
});
