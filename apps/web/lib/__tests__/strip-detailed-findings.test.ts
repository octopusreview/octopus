import { describe, it, expect } from "bun:test";
import { stripDetailedFindings } from "../review-helpers";
import {
  FINDINGS_START_MARKER,
  FINDINGS_END_MARKER,
} from "../review-dedup";

const HIGH_LEVEL = `## 🐙 Octopus Review — PR #42

### Summary
Looks fine overall.

### Score
| Category | Score |
|---|---|
| Security | 4/5 |
| Code Quality | 5/5 |
| Performance | N/A |
| Error Handling | 4/5 |
| Consistency | 5/5 |
| **Overall** | **4/5** |

### Positive Highlights
- Nice atomic update
- Good test coverage

### Checklist
- [x] Tests added
`;

describe("stripDetailedFindings", () => {
  it("strips the documented HTML-marker findings block", () => {
    const findings = `${FINDINGS_START_MARKER}
\`\`\`json
[{"severity":"🔴","title":"x","filePath":"a.ts","startLine":1,"endLine":1,"category":"Bug","description":"y","suggestion":"","confidence":90}]
\`\`\`
${FINDINGS_END_MARKER}`;
    const body = `${HIGH_LEVEL}\n${findings}\n`;
    const out = stripDetailedFindings(body);
    expect(out).not.toContain(FINDINGS_START_MARKER);
    expect(out).not.toContain('"severity"');
    expect(out).toContain("Summary");
  });

  it("strips a stray ```json block that looks like findings (no markers)", () => {
    // Some models emit the JSON without the documented HTML-comment markers.
    // If it has severity+filePath keys, it's a findings array — drop it.
    const body =
      HIGH_LEVEL +
      '\n```json\n' +
      '[{"severity":"🟠","title":"y","filePath":"b.ts","startLine":5,"endLine":5,"description":"z"}]\n' +
      "```\n";
    const out = stripDetailedFindings(body);
    expect(out).not.toContain("```json");
    expect(out).not.toContain('"filePath"');
  });

  it("keeps unrelated ```json fenced blocks (e.g. config examples)", () => {
    const body =
      HIGH_LEVEL +
      '\n### Diagram\n```json\n{ "config": { "key": "value" } }\n```\n';
    const out = stripDetailedFindings(body);
    expect(out).toContain('"key": "value"');
  });

  it("strips individual #### emoji finding sections (the /u flag fix)", () => {
    // Pre-fix the char class without /u matched lone surrogates, so these
    // sections survived unchanged. Use the real severity emoji to catch
    // the regression.
    const body =
      HIGH_LEVEL +
      "\n#### 🔴 SQL injection\n**File:** `db.ts:42`\nLong prose about the bug.\n" +
      "\n#### 🟠 Race condition\n**File:** `mutex.ts:7`\nMore prose.\n";
    const out = stripDetailedFindings(body);
    expect(out).not.toContain("SQL injection");
    expect(out).not.toContain("Race condition");
    expect(out).not.toContain("🟠");
  });

  it("strips #### Finding #N: sections too", () => {
    const body =
      HIGH_LEVEL +
      "\n#### Finding #1: SQL injection\nBig description.\n" +
      "\n#### Finding #2: Missing null check\nMore.\n";
    const out = stripDetailedFindings(body);
    expect(out).not.toContain("SQL injection");
    expect(out).not.toContain("Missing null check");
  });

  it("strips off-prompt heading variants (Bug Details, Issues, etc.)", () => {
    const body =
      HIGH_LEVEL +
      "\n### Bugs\nList of bugs with details.\n\n### More\n";
    const out = stripDetailedFindings(body);
    expect(out).not.toContain("List of bugs with details");
    expect(out).toContain("### More");
  });

  it("strips trailing ## Findings H2 section", () => {
    const body =
      HIGH_LEVEL +
      "\n## Findings (3)\n\n#### 🔴 issue A\ndesc\n\n#### 🟡 issue B\ndesc\n";
    const out = stripDetailedFindings(body);
    expect(out).not.toContain("issue A");
    expect(out).not.toContain("issue B");
    expect(out).not.toContain("## Findings");
  });

  it("preserves the high-level overview untouched", () => {
    const body = HIGH_LEVEL;
    const out = stripDetailedFindings(body);
    expect(out).toContain("Summary");
    expect(out).toContain("Score");
    expect(out).toContain("Positive Highlights");
    expect(out).toContain("Checklist");
  });

  it("idempotent on bodies with no findings content", () => {
    const out = stripDetailedFindings(HIGH_LEVEL);
    const out2 = stripDetailedFindings(out);
    expect(out2).toBe(out);
  });

  it("collapses excessive blank lines after stripping", () => {
    const body =
      "### Summary\nshort\n\n" +
      `${FINDINGS_START_MARKER}\nfindings\n${FINDINGS_END_MARKER}\n\n\n\n` +
      "### Checklist\n- [x] done\n";
    const out = stripDetailedFindings(body);
    expect(out).not.toMatch(/\n{3,}/);
  });
});
