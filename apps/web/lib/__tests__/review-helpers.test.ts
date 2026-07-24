import { describe, it, expect } from "bun:test";
import { formatPastReviews, formatPrIntent, type PastReviewHit } from "@/lib/review-helpers";

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
