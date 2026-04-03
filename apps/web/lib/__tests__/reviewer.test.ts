import { describe, it, expect } from "bun:test";
import {
  touchesSharedFiles,
  extractUserInstruction,
  countFindings,
  countFindingsFromTable,
  parseDiffLines,
  sortAndCapFindings,
  buildLowSeveritySummary,
  stripDetailedFindings,
  buildInlineComments,
  mergeReviewConfigs,
  parseReviewConfig,
} from "@/lib/review-helpers";
import type { InlineFinding } from "@/lib/review-dedup";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeFinding(overrides: Partial<InlineFinding> = {}): InlineFinding {
  return {
    severity: "🟡",
    title: "Test finding",
    filePath: "src/index.ts",
    startLine: 10,
    endLine: 12,
    category: "correctness",
    description: "Something is wrong",
    suggestion: "",
    confidence: 90,
    ...overrides,
  };
}

// ─── touchesSharedFiles ─────────────────────────────────────────────────────

describe("touchesSharedFiles", () => {
  it("detects types directory", () => {
    expect(touchesSharedFiles("diff --git a/src/types/user.ts b/src/types/user.ts")).toBe(true);
  });

  it("detects utils directory", () => {
    expect(touchesSharedFiles("diff --git a/lib/utils/format.ts b/lib/utils/format.ts")).toBe(true);
  });

  it("detects package.json", () => {
    expect(touchesSharedFiles("diff --git a/package.json b/package.json")).toBe(true);
  });

  it("detects tsconfig", () => {
    expect(touchesSharedFiles("diff --git a/tsconfig.json b/tsconfig.json")).toBe(true);
  });

  it("detects .d.ts files", () => {
    expect(touchesSharedFiles("diff --git a/src/global.d.ts b/src/global.d.ts")).toBe(true);
  });

  it("detects prisma schema", () => {
    expect(touchesSharedFiles("diff --git a/prisma/schema/main.prisma b/prisma/schema/main.prisma")).toBe(true);
  });

  it("returns false for regular source files", () => {
    expect(touchesSharedFiles("diff --git a/src/components/Button.tsx b/src/components/Button.tsx")).toBe(false);
  });

  it("returns false for empty diff", () => {
    expect(touchesSharedFiles("")).toBe(false);
  });
});

// ─── extractUserInstruction ─────────────────────────────────────────────────

describe("extractUserInstruction", () => {
  it("extracts instruction after @octopus mention", () => {
    expect(extractUserInstruction("@octopus please focus on security")).toBe("please focus on security");
  });

  it("extracts instruction after @octopus-review mention", () => {
    expect(extractUserInstruction("@octopus-review check for XSS")).toBe("check for XSS");
  });

  it("strips bare 'review' keyword", () => {
    expect(extractUserInstruction("@octopus review")).toBe("");
  });

  it("strips 'review' prefix but keeps the rest", () => {
    expect(extractUserInstruction("@octopus review this carefully")).toBe("this carefully");
  });

  it("returns empty string when no mention", () => {
    expect(extractUserInstruction("just a regular comment")).toBe("");
  });

  it("is case insensitive", () => {
    expect(extractUserInstruction("@OCTOPUS check types")).toBe("check types");
  });
});

// ─── countFindings ──────────────────────────────────────────────────────────

describe("countFindings", () => {
  it("counts JSON findings", () => {
    const body = `Some review text
<!-- OCTOPUS_FINDINGS_START -->
[
  {"severity":"🔴","title":"Bug","filePath":"a.ts","startLine":1,"description":"bad"},
  {"severity":"🟡","title":"Style","filePath":"b.ts","startLine":5,"description":"meh"}
]
<!-- OCTOPUS_FINDINGS_END -->`;
    expect(countFindings(body)).toBe(2);
  });

  it("counts legacy markdown findings", () => {
    const body = `## Review
#### 🔴 Critical bug
Some details
#### 🟡 Style issue
More details
#### 💡 Suggestion
Something`;
    expect(countFindings(body)).toBe(3);
  });

  it("returns 0 for no findings", () => {
    expect(countFindings("Just a review with no findings")).toBe(0);
  });
});

// ─── countFindingsFromTable ─────────────────────────────────────────────────

describe("countFindingsFromTable", () => {
  it("sums findings from table rows", () => {
    const body = `| 🔴 Critical | 2 |
| 🟡 Medium | 5 |
| 💡 Suggestion | 3 |`;
    expect(countFindingsFromTable(body)).toBe(10);
  });

  it("returns 0 when no table rows", () => {
    expect(countFindingsFromTable("no table here")).toBe(0);
  });
});

// ─── parseDiffLines ─────────────────────────────────────────────────────────

describe("parseDiffLines", () => {
  it("parses added lines from a simple diff", () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
@@ -1,3 +1,5 @@
 import express from "express";
+import cors from "cors";
+import helmet from "helmet";

 const app = express();`;

    const result = parseDiffLines(diff);
    const lines = result.get("src/app.ts")!;
    expect(lines).toBeDefined();
    // Line 1 is context, lines 2-3 are added, line 4 is context (blank), line 5 is context
    expect(lines.has(1)).toBe(true);  // context
    expect(lines.has(2)).toBe(true);  // added
    expect(lines.has(3)).toBe(true);  // added
    expect(lines.has(4)).toBe(true);  // context (blank line)
    expect(lines.has(5)).toBe(true);  // context
  });

  it("handles deleted lines (does not add them)", () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
@@ -1,4 +1,3 @@
 import express from "express";
-import cors from "cors";

 const app = express();`;

    const result = parseDiffLines(diff);
    const lines = result.get("src/app.ts")!;
    // After deletion, remaining lines are 1, 2 (blank), 3
    expect(lines.has(1)).toBe(true);
    expect(lines.has(2)).toBe(true);
    expect(lines.has(3)).toBe(true);
  });

  it("handles multiple files", () => {
    const diff = `diff --git a/a.ts b/a.ts
@@ -1,2 +1,3 @@
 line1
+added
 line2
diff --git a/b.ts b/b.ts
@@ -1,2 +1,3 @@
 foo
+bar
 baz`;

    const result = parseDiffLines(diff);
    expect(result.has("a.ts")).toBe(true);
    expect(result.has("b.ts")).toBe(true);
    expect(result.get("a.ts")!.has(2)).toBe(true); // added line
    expect(result.get("b.ts")!.has(2)).toBe(true); // added line
  });

  it("handles non-starting hunk offset", () => {
    const diff = `diff --git a/src/utils.ts b/src/utils.ts
@@ -50,3 +50,4 @@
 existing line
+new line
 another line
 last line`;

    const result = parseDiffLines(diff);
    const lines = result.get("src/utils.ts")!;
    expect(lines.has(50)).toBe(true);  // context
    expect(lines.has(51)).toBe(true);  // added
    expect(lines.has(52)).toBe(true);  // context
    expect(lines.has(53)).toBe(true);  // context
  });

  it("returns empty map for empty diff", () => {
    expect(parseDiffLines("").size).toBe(0);
  });
});

// ─── sortAndCapFindings ─────────────────────────────────────────────────────

describe("sortAndCapFindings", () => {
  it("sorts by severity priority (critical first)", () => {
    const findings = [
      makeFinding({ severity: "💡", title: "nit" }),
      makeFinding({ severity: "🔴", title: "critical" }),
      makeFinding({ severity: "🟡", title: "medium" }),
    ];
    const { kept } = sortAndCapFindings(findings, 10);
    expect(kept[0].severity).toBe("🔴");
    expect(kept[1].severity).toBe("🟡");
    expect(kept[2].severity).toBe("💡");
  });

  it("caps at max and returns truncated count", () => {
    const findings = [
      makeFinding({ severity: "🔴", title: "a" }),
      makeFinding({ severity: "🟠", title: "b" }),
      makeFinding({ severity: "🟡", title: "c" }),
      makeFinding({ severity: "🔵", title: "d" }),
      makeFinding({ severity: "💡", title: "e" }),
    ];
    const { kept, truncatedCount } = sortAndCapFindings(findings, 3);
    expect(kept.length).toBe(3);
    expect(truncatedCount).toBe(2);
    // Should keep highest severity findings
    expect(kept[0].severity).toBe("🔴");
    expect(kept[1].severity).toBe("🟠");
    expect(kept[2].severity).toBe("🟡");
  });

  it("returns all when under max", () => {
    const findings = [makeFinding(), makeFinding()];
    const { kept, truncatedCount } = sortAndCapFindings(findings, 10);
    expect(kept.length).toBe(2);
    expect(truncatedCount).toBe(0);
  });

  it("handles empty findings", () => {
    const { kept, truncatedCount } = sortAndCapFindings([], 10);
    expect(kept.length).toBe(0);
    expect(truncatedCount).toBe(0);
  });
});

// ─── buildLowSeveritySummary ────────────────────────────────────────────────

describe("buildLowSeveritySummary", () => {
  it("returns empty string for no findings", () => {
    expect(buildLowSeveritySummary([])).toBe("");
  });

  it("puts critical/high findings prominently (not collapsed)", () => {
    const findings = [makeFinding({ severity: "🔴", title: "Critical bug" })];
    const result = buildLowSeveritySummary(findings);
    expect(result).toContain("🔴");
    expect(result).toContain("Findings that could not be mapped");
    expect(result).not.toContain("<details>");
  });

  it("puts low severity findings in collapsed section", () => {
    const findings = [makeFinding({ severity: "🟡", title: "Style issue" })];
    const result = buildLowSeveritySummary(findings);
    expect(result).toContain("<details>");
    expect(result).toContain("Additional findings");
  });

  it("separates high and low severity findings", () => {
    const findings = [
      makeFinding({ severity: "🔴", title: "Critical" }),
      makeFinding({ severity: "💡", title: "Nit" }),
    ];
    const result = buildLowSeveritySummary(findings);
    expect(result).toContain("Findings that could not be mapped");
    expect(result).toContain("<details>");
  });
});

// ─── stripDetailedFindings ──────────────────────────────────────────────────

describe("stripDetailedFindings", () => {
  it("strips JSON findings block", () => {
    const body = `## Summary\nGood code\n<!-- OCTOPUS_FINDINGS_START -->\n[{"severity":"🔴"}]\n<!-- OCTOPUS_FINDINGS_END -->\n## Score\n9/10`;
    const result = stripDetailedFindings(body);
    expect(result).toContain("## Summary");
    expect(result).toContain("## Score");
    expect(result).not.toContain("OCTOPUS_FINDINGS");
    expect(result).not.toContain("severity");
  });

  it("strips legacy detailed findings block", () => {
    const body = `## Summary\nGood\n<details>\n<summary>Detailed Findings</summary>\nLots of stuff\n</details>\n## Score\n9/10`;
    const result = stripDetailedFindings(body);
    expect(result).toContain("## Summary");
    expect(result).not.toContain("Detailed Findings");
  });

  it("strips ### Detailed Findings section", () => {
    const body = `## Summary\nGood\n### Detailed Findings\n#### 🔴 Bug\nBad stuff\n### Score\n9/10`;
    const result = stripDetailedFindings(body);
    expect(result).toContain("## Summary");
    expect(result).not.toContain("Detailed Findings");
    expect(result).toContain("### Score");
  });

  it("strips ### Findings Summary section", () => {
    const body = `## Summary\nGood\n### Findings Summary\n| 🔴 | 2 |\n### Score\n9/10`;
    const result = stripDetailedFindings(body);
    expect(result).not.toContain("Findings Summary");
  });

  it("preserves body when no findings present", () => {
    const body = "## Summary\nGreat code, no issues.";
    expect(stripDetailedFindings(body)).toBe(body);
  });
});

// ─── buildInlineComments ────────────────────────────────────────────────────

describe("buildInlineComments", () => {
  it("creates comment for finding on valid diff line", () => {
    const findings = [makeFinding({ filePath: "src/index.ts", startLine: 10, endLine: 12 })];
    const diffLines = new Map([["src/index.ts", new Set([10, 11, 12, 13])]]);
    const comments = buildInlineComments(findings, diffLines);
    expect(comments.length).toBe(1);
    expect(comments[0].path).toBe("src/index.ts");
    expect(comments[0].line).toBe(12); // prefers endLine
    expect(comments[0].side).toBe("RIGHT");
  });

  it("falls back to startLine if endLine not in diff", () => {
    const findings = [makeFinding({ startLine: 10, endLine: 15 })];
    const diffLines = new Map([["src/index.ts", new Set([10, 11])]]);
    const comments = buildInlineComments(findings, diffLines);
    expect(comments.length).toBe(1);
    expect(comments[0].line).toBe(10);
  });

  it("skips finding if file not in diff", () => {
    const findings = [makeFinding({ filePath: "other.ts" })];
    const diffLines = new Map([["src/index.ts", new Set([10])]]);
    expect(buildInlineComments(findings, diffLines).length).toBe(0);
  });

  it("skips finding if no valid line found", () => {
    const findings = [makeFinding({ startLine: 100, endLine: 105 })];
    const diffLines = new Map([["src/index.ts", new Set([1, 2, 3])]]);
    expect(buildInlineComments(findings, diffLines).length).toBe(0);
  });

  it("includes suggestion block for GitHub", () => {
    const findings = [makeFinding({ suggestion: "const x = 1;" })];
    const diffLines = new Map([["src/index.ts", new Set([10, 11, 12])]]);
    const comments = buildInlineComments(findings, diffLines, "github");
    expect(comments[0].body).toContain("```suggestion");
  });

  it("uses plain code block for Bitbucket suggestions", () => {
    const findings = [makeFinding({ suggestion: "const x = 1;" })];
    const diffLines = new Map([["src/index.ts", new Set([10, 11, 12])]]);
    const comments = buildInlineComments(findings, diffLines, "bitbucket");
    expect(comments[0].body).toContain("**Suggested fix:**");
    expect(comments[0].body).not.toContain("```suggestion");
  });

  it("includes AI Fix Prompt section", () => {
    const findings = [makeFinding()];
    const diffLines = new Map([["src/index.ts", new Set([10, 11, 12])]]);
    const comments = buildInlineComments(findings, diffLines);
    expect(comments[0].body).toContain("AI Fix Prompt");
  });
});

// ─── mergeReviewConfigs ─────────────────────────────────────────────────────

describe("mergeReviewConfigs", () => {
  it("merges multiple configs with later values winning", () => {
    const result = mergeReviewConfigs(
      { maxFindings: 10, inlineThreshold: "medium" },
      { maxFindings: 20 },
    );
    expect(result.maxFindings).toBe(20);
    expect(result.inlineThreshold).toBe("medium");
  });

  it("returns empty object for no configs", () => {
    expect(mergeReviewConfigs()).toEqual({});
  });

  it("handles all fields", () => {
    const result = mergeReviewConfigs({
      maxFindings: 15,
      inlineThreshold: "high",
      enableConflictDetection: true,
      disabledCategories: ["style"],
      confidenceThreshold: "HIGH",
      enableTwoPassReview: true,
    });
    expect(result.maxFindings).toBe(15);
    expect(result.enableConflictDetection).toBe(true);
    expect(result.disabledCategories).toEqual(["style"]);
    expect(result.enableTwoPassReview).toBe(true);
  });
});

// ─── parseReviewConfig ──────────────────────────────────────────────────────

describe("parseReviewConfig", () => {
  it("returns empty object for null", () => {
    expect(parseReviewConfig(null)).toEqual({});
  });

  it("returns empty object for non-object", () => {
    expect(parseReviewConfig("string")).toEqual({});
  });

  it("passes through valid config object", () => {
    const config = { maxFindings: 20, inlineThreshold: "high" };
    expect(parseReviewConfig(config)).toEqual(config);
  });
});
