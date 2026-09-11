import { describe, expect, it } from "bun:test";
import { MAX_DIFF_CHARS } from "@/lib/diff-truncate";
import { buildGeneratedMatcher } from "@/lib/generated-files";
import { coverageCounts, prepareReviewInput, reviewCheckResult, sha256, type ReviewInput } from "@/lib/review-coverage";

describe("bounded changed-source capacity", () => {
  const generated = buildGeneratedMatcher();
  const patch = (chars: number) => `@@ -0,0 +1 @@\n+${"x".repeat(chars)}\n`;
  const input: ReviewInput = {
    provider: "github", headSha: "a".repeat(40), baseSha: "b".repeat(40),
    expectedFiles: 4, inventoryComplete: true, limitations: [],
    files: [
      { path: "src/main.ts", change: "added", patch: patch(290000), additions: 1, deletions: 0 },
      { path: "src/main.test.ts", change: "added", patch: patch(25000), additions: 1, deletions: 0 },
      { path: "README.md", change: "added", patch: patch(8000), additions: 1, deletions: 0 },
      { path: "web/drizzle/meta/_journal.json", change: "added", patch: patch(5000), additions: 1, deletions: 0 },
    ],
  };

  it("supplies every eligible hunk beyond the old limit, preserving exclusions", async () => {
    const old = prepareReviewInput(input, { maxChars: 300000, generated });
    expect(old.coverage.complete).toBe(false);
    expect(old.coverage.files.find(f => f.path === "src/main.test.ts")?.state).toBe("omitted");
    const full = prepareReviewInput(input, { maxChars: MAX_DIFF_CHARS, generated });
    expect(full.diff.length).toBeLessThanOrEqual(MAX_DIFF_CHARS);
    expect(full.coverage.complete).toBe(true);
    expect(coverageCounts(full.coverage)).toEqual({ total: 4, supplied: 3, partial: 0, omitted: 0, excluded: 1, unavailable: 0 });
    for (const file of input.files.slice(0, 3)) {
      const covered = full.coverage.files.find(f => f.path === file.path)!;
      expect(covered.hunks.map(h => h.sha256)).toEqual([sha256(file.patch!)]);
      expect(full.diff).toContain(file.patch!);
    }
    expect(full.diff).not.toContain("_journal.json");
    // Complete input cannot substitute for a valid model assessment.
    expect(reviewCheckResult(full.coverage, false, 0).conclusion).toBe("failure");
    if (process.env.REVIEW_TEST_EVIDENCE_DIR) {
      await Bun.write(`${process.env.REVIEW_TEST_EVIDENCE_DIR}/capacity-comparison.json`, JSON.stringify({
        oldLimit: 300000, oldCounts: coverageCounts(old.coverage), oldComplete: old.coverage.complete,
        defaultLimit: MAX_DIFF_CHARS, preparedCharacters: full.diff.length,
        counts: coverageCounts(full.coverage), coverage: full.coverage,
        checkWithoutAssessment: reviewCheckResult(full.coverage, false, 0),
      }, null, 2));
    }
  });

  it("keeps larger input explicitly incomplete under the same bounded default", () => {
    const oversized = { ...input, files: input.files.map((f, i) => i === 0 ? { ...f, patch: patch(MAX_DIFF_CHARS + 1) } : f) };
    const result = prepareReviewInput(oversized, { maxChars: MAX_DIFF_CHARS, generated });
    expect(result.diff.length).toBeLessThanOrEqual(MAX_DIFF_CHARS);
    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.files[0].state).toBe("omitted");
    expect(reviewCheckResult(result.coverage, false, 0).conclusion).toBe("failure");
  });
});
