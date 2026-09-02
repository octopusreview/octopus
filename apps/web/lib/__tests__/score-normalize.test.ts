import { describe, it, expect } from "bun:test";
import { normalizeScoreDenominators, reconcileScoreTable, normalizeLastReviewedCommit } from "@/lib/review-helpers";

const scoreSection = (rows: string) => `## 🐙 Octopus Review — PR #42

### Summary
Adds a turn picker component.

### Score
| Category | Score | Notes |
|----------|-------|-------|
${rows}

### Risk Assessment
| Metric | Value |
|--------|-------|
| Overall Risk | 🟢 Low |
`;

describe("normalizeScoreDenominators", () => {
  it("rewrites a wrong denominator to /5", () => {
    const body = scoreSection(
      `| Security | 5/5 | Pure local UI state |
| Performance | 4/4 | Clamp + slice fine for ≤50 turns |`,
    );
    const result = normalizeScoreDenominators(body);
    expect(result).toContain("| Performance | 4/5 |");
    expect(result).not.toContain("4/4");
  });

  it("keeps correct /5 scores untouched", () => {
    const body = scoreSection(
      `| Security | 5/5 | Fine |
| Code Quality | 3/5 | Medium concerns |`,
    );
    expect(normalizeScoreDenominators(body)).toBe(body);
  });

  it("normalizes the bold Overall row", () => {
    const body = scoreSection(`| **Overall** | **4/4** | Lowest individual score |`);
    const result = normalizeScoreDenominators(body);
    expect(result).toContain("| **Overall** | **4/5** |");
  });

  it("leaves N/A rows untouched", () => {
    const body = scoreSection(`| Security | N/A | No security-relevant changes |`);
    expect(normalizeScoreDenominators(body)).toBe(body);
  });

  it("does not touch fractions outside the Score section", () => {
    const body = `${scoreSection(`| Security | 5/5 | Fine |`)}
### Checklist
- [x] 4/4 tests passed
`;
    const result = normalizeScoreDenominators(body);
    expect(result).toContain("4/4 tests passed");
  });

  it("does not touch numerators above the 1-5 rubric range", () => {
    const body = scoreSection(`| Security | 8/10 | Out-of-rubric output |`);
    expect(normalizeScoreDenominators(body)).toBe(body);
  });

  it("handles a Score section at the end of the body", () => {
    const body = `### Score
| Category | Score | Notes |
|----------|-------|-------|
| Security | 4/4 | Minor nits |`;
    const result = normalizeScoreDenominators(body);
    expect(result).toContain("| Security | 4/5 |");
  });
});

describe("reconcileScoreTable", () => {
  const noFindings = { hasCritical: false, hasHigh: false, hasMedium: false };

  it("floors sub-4 categories and Overall when there are no blocking findings (the qwen-telegram #5 case)", () => {
    const body = scoreSection(
      `| Security | 5/5 | Gate order preserved |
| Code Quality | 3/5 | Trial env defaults violate org env-var policy |
| Performance | N/A | One extra usage() fetch is trivial |
| Error Handling | 3/5 | verify RETURNING includes column |
| Consistency | 4/5 | Follows established patterns |
| **Overall** | **3/5** | Lowest individual score |`,
    );
    const result = reconcileScoreTable(body, noFindings);
    expect(result).toContain("| Code Quality | 4/5 |");
    expect(result).toContain("| Error Handling | 4/5 |");
    expect(result).toContain("| **Overall** | **4/5** |");
    // preserved
    expect(result).toContain("| Security | 5/5 |");
    expect(result).toContain("| Consistency | 4/5 |");
    expect(result).toContain("| Performance | N/A |");
    expect(result).toContain("verify RETURNING includes column"); // notes kept
    expect(result).not.toContain("3/5"); // no below-gate score survives
  });

  it("leaves the score untouched when a critical finding exists", () => {
    const body = scoreSection(`| **Overall** | **2/5** | Critical issue found |`);
    expect(reconcileScoreTable(body, { hasCritical: true, hasHigh: false, hasMedium: false })).toBe(body);
  });

  it("leaves the score untouched when only a medium finding exists (a real concern justifies a low score)", () => {
    const body = scoreSection(
      `| Code Quality | 3/5 | Medium concern |
| **Overall** | **3/5** | Lowest individual score |`,
    );
    expect(reconcileScoreTable(body, { hasCritical: false, hasHigh: false, hasMedium: true })).toBe(body);
  });

  it("is a no-op when every category already clears the floor", () => {
    const body = scoreSection(
      `| Security | 5/5 | Fine |
| **Overall** | **4/5** | Lowest individual score |`,
    );
    expect(reconcileScoreTable(body, noFindings)).toBe(body);
  });

  it("does not touch fractions outside the Score section", () => {
    const body = `${scoreSection(`| **Overall** | **3/5** | Lowest individual score |`)}
### Checklist
- [ ] 2/5 edge cases covered
`;
    const result = reconcileScoreTable(body, noFindings);
    expect(result).toContain("2/5 edge cases covered");
    expect(result).toContain("| **Overall** | **4/5** |");
  });

  it("no-ops when there is no Score table", () => {
    const body = "### Summary\nAll good, nothing to score.\n";
    expect(reconcileScoreTable(body, noFindings)).toBe(body);
  });
});

describe("normalizeLastReviewedCommit", () => {
  const sha = "9e794def0fbfe8df5f37a871fcf65bbb6ee5421a";

  it("replaces a short SHA with the full reviewed head", () => {
    const body = "### Diagram\n(none)\n\nLast reviewed commit: 9e794de\n\n### Checklist";
    expect(normalizeLastReviewedCommit(body, sha)).toBe(`### Diagram\n(none)\n\nLast reviewed commit: ${sha}\n\n### Checklist`);
  });

  it("replaces a paraphrased or placeholder value too", () => {
    const body = "Last reviewed commit: current head";
    expect(normalizeLastReviewedCommit(body, sha)).toBe(`Last reviewed commit: ${sha}`);
  });

  it("leaves the body alone without the line or without a valid head", () => {
    expect(normalizeLastReviewedCommit("### Checklist\n- [ ] x", sha)).toBe("### Checklist\n- [ ] x");
    expect(normalizeLastReviewedCommit("Last reviewed commit: 9e794de", null)).toBe("Last reviewed commit: 9e794de");
    expect(normalizeLastReviewedCommit("Last reviewed commit: 9e794de", "not-a-sha")).toBe("Last reviewed commit: 9e794de");
  });
});
