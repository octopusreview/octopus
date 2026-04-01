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
  parseReviewConfig,
  mergeReviewConfigs,
  SEVERITY_PRIORITY,
  MAX_FINDINGS_PER_REVIEW,
  type ReviewComment,
} from "@/lib/review-helpers";
import type { InlineFinding } from "@/lib/review-dedup";

describe("touchesSharedFiles", () => {
  it("detects types directory", () => {
    expect(touchesSharedFiles("diff --git a/src/types/user.ts b/src/types/user.ts")).toBe(true);
  });

  it("detects utils directory", () => {
    expect(touchesSharedFiles("diff --git a/lib/utils/format.ts b/lib/utils/format.ts")).toBe(true);
  });

  it("detects prisma schema", () => {
    expect(touchesSharedFiles("diff --git a/prisma/schema/main.prisma b/prisma/schema/main.prisma")).toBe(true);
  });

  it("detects package.json", () => {
    expect(touchesSharedFiles("diff --git a/package.json b/package.json")).toBe(true);
  });

  it("detects tsconfig", () => {
    expect(touchesSharedFiles("diff --git a/tsconfig.json b/tsconfig.json")).toBe(true);
  });

  it("returns false for regular source files", () => {
    expect(touchesSharedFiles("diff --git a/src/app/page.tsx b/src/app/page.tsx")).toBe(false);
  });
});

describe("extractUserInstruction", () => {
  it("extracts instruction after @octopus", () => {
    expect(extractUserInstruction("@octopus focus on security")).toBe("focus on security");
  });

  it("extracts instruction after @octopus-review", () => {
    expect(extractUserInstruction("@octopus-review check error handling")).toBe("check error handling");
  });

  it("strips bare review keyword", () => {
    expect(extractUserInstruction("@octopus review")).toBe("");
  });

  it("strips review keyword but keeps rest", () => {
    expect(extractUserInstruction("@octopus review with extra focus on perf")).toBe("with extra focus on perf");
  });

  it("returns empty for no mention", () => {
    expect(extractUserInstruction("just a regular comment")).toBe("");
  });

  it("handles multiline instruction", () => {
    const result = extractUserInstruction("@octopus please check\n- auth\n- validation");
    expect(result).toContain("please check");
    expect(result).toContain("- auth");
  });
});

describe("countFindings", () => {
  it("counts markdown heading findings", () => {
    const body = "#### 🔴 Critical issue\nsome text\n#### 🟡 Medium issue\nmore text";
    expect(countFindings(body)).toBe(2);
  });

  it("returns 0 for no findings", () => {
    expect(countFindings("This PR looks good, no issues found.")).toBe(0);
  });
});

describe("countFindingsFromTable", () => {
  it("counts findings from severity table", () => {
    const body = "| 🔴 Critical | 2 |\n| 🟡 Medium | 5 |\n| 💡 Nit | 1 |";
    expect(countFindingsFromTable(body)).toBe(8);
  });

  it("returns 0 when no table present", () => {
    expect(countFindingsFromTable("no table here")).toBe(0);
  });
});

describe("parseDiffLines", () => {
  it("parses added lines from unified diff", () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
@@ -10,3 +10,5 @@ function main() {
 context line
+added line 1
+added line 2
 another context`;
    const result = parseDiffLines(diff);
    expect(result.has("src/app.ts")).toBe(true);
    const lines = result.get("src/app.ts")!;
    // hunk starts at +10: context(10), added(11), added(12), context(13)
    expect(lines.has(10)).toBe(true);
    expect(lines.has(11)).toBe(true);
    expect(lines.has(12)).toBe(true);
    expect(lines.has(13)).toBe(true);
    expect(lines.size).toBe(4);
  });

  it("handles multiple files", () => {
    const diff = `diff --git a/a.ts b/a.ts
@@ -1,1 +1,2 @@
 old
+new
diff --git a/b.ts b/b.ts
@@ -1,1 +1,2 @@
 old
+new`;
    const result = parseDiffLines(diff);
    expect(result.size).toBe(2);
    expect(result.has("a.ts")).toBe(true);
    expect(result.has("b.ts")).toBe(true);
  });

  it("skips deleted lines", () => {
    const diff = `diff --git a/x.ts b/x.ts
@@ -1,3 +1,2 @@
 keep
-removed
 also keep`;
    const result = parseDiffLines(diff);
    const lines = result.get("x.ts")!;
    expect(lines.has(1)).toBe(true); // keep
    expect(lines.has(2)).toBe(true); // also keep
  });

  it("returns empty map for empty diff", () => {
    expect(parseDiffLines("").size).toBe(0);
  });
});

describe("sortAndCapFindings", () => {
  const makeFinding = (severity: string): InlineFinding => ({
    severity,
    title: `${severity} finding`,
    description: "desc",
    filePath: "test.ts",
    startLine: 1,
    endLine: 1,
    category: "test",
  });

  it("sorts by severity priority", () => {
    const findings = [makeFinding("💡"), makeFinding("🔴"), makeFinding("🟡")];
    const { kept } = sortAndCapFindings(findings, 10);
    expect(kept[0].severity).toBe("🔴");
    expect(kept[1].severity).toBe("🟡");
    expect(kept[2].severity).toBe("💡");
  });

  it("caps at max and returns truncated count", () => {
    const findings = [makeFinding("🔴"), makeFinding("🟡"), makeFinding("💡")];
    const { kept, truncatedCount } = sortAndCapFindings(findings, 2);
    expect(kept.length).toBe(2);
    expect(truncatedCount).toBe(1);
  });

  it("returns all if under max", () => {
    const findings = [makeFinding("🔴")];
    const { kept, truncatedCount } = sortAndCapFindings(findings, 10);
    expect(kept.length).toBe(1);
    expect(truncatedCount).toBe(0);
  });
});

describe("buildLowSeveritySummary", () => {
  const makeFinding = (severity: string, title: string): InlineFinding => ({
    severity,
    title,
    description: "some description",
    filePath: "test.ts",
    startLine: 1,
    endLine: 1,
    category: "test",
  });

  it("returns empty string for no findings", () => {
    expect(buildLowSeveritySummary([])).toBe("");
  });

  it("shows high severity findings prominently with bold header", () => {
    const findings = [makeFinding("🔴", "Critical bug")];
    const result = buildLowSeveritySummary(findings);
    expect(result).toContain("Critical bug");
    expect(result).toContain("**🔴 Findings that could not be mapped to diff lines:**");
    expect(result).toContain("| Severity |");
    expect(result).not.toContain("<details>");
  });

  it("puts low severity in collapsed details section", () => {
    const findings = [makeFinding("💡", "Style nit")];
    const result = buildLowSeveritySummary(findings);
    expect(result).toContain("<details>");
    expect(result).toContain("<summary>💡 Additional findings</summary>");
    expect(result).toContain("Style nit");
    expect(result).toContain("</details>");
  });

  it("separates high and low severity in mixed findings", () => {
    const findings = [makeFinding("🔴", "Critical"), makeFinding("💡", "Nit")];
    const result = buildLowSeveritySummary(findings);
    expect(result).toContain("**🔴 Findings");
    expect(result).toContain("<details>");
    expect(result).toContain("Critical");
    expect(result).toContain("Nit");
  });
});

describe("stripDetailedFindings", () => {
  it("removes Detailed Findings section but keeps surrounding content", () => {
    const body = "## Summary\nGood.\n### Detailed Findings\n#### 🔴 Bug\nbroken\n## Checklist\n- done";
    const result = stripDetailedFindings(body);
    expect(result).toContain("## Summary");
    expect(result).toContain("## Checklist");
    expect(result).not.toContain("Detailed Findings");
    expect(result).not.toContain("Bug");
  });

  it("removes Findings Summary section but keeps surrounding content", () => {
    const body = "## Summary\nOK\n### Findings Summary\n| 🔴 | 2 |\n## Checklist";
    const result = stripDetailedFindings(body);
    expect(result).not.toContain("Findings Summary");
    expect(result).toContain("## Checklist");
  });

  it("preserves content with no finding sections", () => {
    const body = "## Summary\nGreat work!\n## Checklist\n- [x] Tests pass";
    const result = stripDetailedFindings(body);
    expect(result).toContain("Summary");
    expect(result).toContain("Checklist");
  });

  it("removes numbered finding headings", () => {
    const body = "## Summary\nOK\n#### Finding #1: Bug\nDetails here\n### Next Section";
    const result = stripDetailedFindings(body);
    expect(result).not.toContain("Finding #1");
    expect(result).toContain("Next Section");
  });

  it("removes Critical Findings section", () => {
    const body = "## Summary\nOK\n### Critical Findings\nSome critical stuff\n## Checklist";
    const result = stripDetailedFindings(body);
    expect(result).not.toContain("Critical Findings");
    expect(result).toContain("## Checklist");
  });
});

describe("parseReviewConfig", () => {
  it("returns empty object for null", () => {
    expect(parseReviewConfig(null)).toEqual({});
  });

  it("returns empty object for non-object", () => {
    expect(parseReviewConfig("string")).toEqual({});
  });

  it("passes through valid config", () => {
    const cfg = { maxFindings: 10, inlineThreshold: "high" };
    expect(parseReviewConfig(cfg)).toEqual(cfg);
  });
});

describe("mergeReviewConfigs", () => {
  it("later configs override earlier ones", () => {
    const result = mergeReviewConfigs(
      { maxFindings: 10 },
      { maxFindings: 20, inlineThreshold: "critical" },
    );
    expect(result.maxFindings).toBe(20);
    expect(result.inlineThreshold).toBe("critical");
  });

  it("preserves fields not overridden", () => {
    const result = mergeReviewConfigs(
      { enableConflictDetection: true, maxFindings: 5 },
      { maxFindings: 15 },
    );
    expect(result.enableConflictDetection).toBe(true);
    expect(result.maxFindings).toBe(15);
  });

  it("handles empty configs", () => {
    expect(mergeReviewConfigs({}, {})).toEqual({});
  });
});

describe("constants", () => {
  it("MAX_FINDINGS_PER_REVIEW is 30", () => {
    expect(MAX_FINDINGS_PER_REVIEW).toBe(30);
  });

  it("SEVERITY_PRIORITY has correct order", () => {
    expect(SEVERITY_PRIORITY["🔴"]).toBeLessThan(SEVERITY_PRIORITY["💡"]);
  });
});

describe("buildInlineComments", () => {
  const makeFinding = (filePath: string, startLine: number, endLine: number): InlineFinding => ({
    severity: "🟡",
    title: "Test finding",
    description: "Something needs fixing",
    filePath,
    startLine,
    endLine,
    category: "test",
  });

  it("creates comment on valid diff line", () => {
    const diffLines = new Map([["src/app.ts", new Set([10, 11, 12])]]);
    const findings = [makeFinding("src/app.ts", 10, 12)];
    const comments = buildInlineComments(findings, diffLines);
    expect(comments.length).toBe(1);
    expect(comments[0].path).toBe("src/app.ts");
    expect(comments[0].line).toBe(12);
    expect(comments[0].side).toBe("RIGHT");
    expect(comments[0].body).toContain("Test finding");
  });

  it("skips findings with no matching file in diff", () => {
    const diffLines = new Map([["other.ts", new Set([1])]]);
    const findings = [makeFinding("missing.ts", 1, 1)];
    expect(buildInlineComments(findings, diffLines)).toEqual([]);
  });

  it("skips findings with no valid lines in range", () => {
    const diffLines = new Map([["src/app.ts", new Set([1, 2])]]);
    const findings = [makeFinding("src/app.ts", 50, 55)];
    expect(buildInlineComments(findings, diffLines)).toEqual([]);
  });

  it("falls back to startLine when endLine not in diff", () => {
    const diffLines = new Map([["src/app.ts", new Set([5])]]);
    const findings = [makeFinding("src/app.ts", 5, 10)];
    const comments = buildInlineComments(findings, diffLines);
    expect(comments.length).toBe(1);
    expect(comments[0].line).toBe(5);
  });

  it("includes suggestion block for github provider", () => {
    const diffLines = new Map([["f.ts", new Set([1])]]);
    const finding: InlineFinding = {
      ...makeFinding("f.ts", 1, 1),
      suggestion: "const x = 1;",
    };
    const comments = buildInlineComments([finding], diffLines, "github");
    expect(comments[0].body).toContain("```suggestion");
  });

  it("uses plain code block for bitbucket provider", () => {
    const diffLines = new Map([["f.ts", new Set([1])]]);
    const finding: InlineFinding = {
      ...makeFinding("f.ts", 1, 1),
      suggestion: "const x = 1;",
    };
    const comments = buildInlineComments([finding], diffLines, "bitbucket");
    expect(comments[0].body).toContain("**Suggested fix:**");
    expect(comments[0].body).not.toContain("```suggestion");
  });

  it("includes AI Fix Prompt section", () => {
    const diffLines = new Map([["f.ts", new Set([1])]]);
    const findings = [makeFinding("f.ts", 1, 1)];
    const comments = buildInlineComments(findings, diffLines);
    expect(comments[0].body).toContain("AI Fix Prompt");
  });

  it("returns empty for empty findings", () => {
    const diffLines = new Map([["f.ts", new Set([1])]]);
    expect(buildInlineComments([], diffLines)).toEqual([]);
  });
});
