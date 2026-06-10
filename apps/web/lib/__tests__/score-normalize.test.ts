import { describe, it, expect } from "bun:test";
import { normalizeScoreDenominators } from "@/lib/review-helpers";

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
