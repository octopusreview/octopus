import { describe, it, expect } from "bun:test";
import {
  extractDiffFiles,
  parseFindingsFromJson,
  parseFindingsFromMarkdown,
  parseFindings,
  extractKeywords,
  jaccardSimilarity,
  deduplicateAgainstPrior,
  parseFindingsFromSummaryTable,
  FINDINGS_START_MARKER,
  FINDINGS_END_MARKER,
} from "@/lib/review-dedup";
import type { InlineFinding, PriorFinding } from "@/lib/review-dedup";

// ─── extractDiffFiles ───────────────────────────────────────────────────────

describe("extractDiffFiles", () => {
  it("extracts file paths from diff", () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
@@ -1,3 +1,5 @@
+import something
diff --git a/src/utils.ts b/src/utils.ts
@@ -10,2 +10,3 @@
+new line`;
    const files = extractDiffFiles(diff);
    expect(files.size).toBe(2);
    expect(files.has("src/app.ts")).toBe(true);
    expect(files.has("src/utils.ts")).toBe(true);
  });

  it("returns empty set for empty diff", () => {
    expect(extractDiffFiles("").size).toBe(0);
  });

  it("handles renamed files (uses b/ side)", () => {
    const diff = "diff --git a/old-name.ts b/new-name.ts";
    const files = extractDiffFiles(diff);
    expect(files.has("new-name.ts")).toBe(true);
    expect(files.has("old-name.ts")).toBe(false);
  });
});

// ─── parseFindingsFromJson ──────────────────────────────────────────────────

describe("parseFindingsFromJson", () => {
  it("parses valid JSON findings block", () => {
    const body = `Review text
${FINDINGS_START_MARKER}
[
  {
    "severity": "🔴",
    "title": "SQL Injection",
    "filePath": "src/api.ts",
    "startLine": 42,
    "endLine": 45,
    "category": "security",
    "description": "User input not sanitized",
    "suggestion": "use parameterized query",
    "confidence": "HIGH"
  }
]
${FINDINGS_END_MARKER}`;
    const findings = parseFindingsFromJson(body);
    expect(findings).not.toBeNull();
    expect(findings!.length).toBe(1);
    expect(findings![0].severity).toBe("🔴");
    expect(findings![0].title).toBe("SQL Injection");
    expect(findings![0].filePath).toBe("src/api.ts");
    expect(findings![0].startLine).toBe(42);
    expect(findings![0].endLine).toBe(45);
    expect(findings![0].confidence).toBe(90);
  });

  it("handles JSON wrapped in code fences", () => {
    const body = `${FINDINGS_START_MARKER}
\`\`\`json
[{"severity":"🟡","title":"Test","filePath":"a.ts","startLine":1,"description":"desc"}]
\`\`\`
${FINDINGS_END_MARKER}`;
    const findings = parseFindingsFromJson(body);
    expect(findings).not.toBeNull();
    expect(findings!.length).toBe(1);
  });

  it("returns null when no markers found", () => {
    expect(parseFindingsFromJson("no markers here")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    const body = `${FINDINGS_START_MARKER}\nnot json\n${FINDINGS_END_MARKER}`;
    expect(parseFindingsFromJson(body)).toBeNull();
  });

  it("returns null for non-array JSON", () => {
    const body = `${FINDINGS_START_MARKER}\n{"not":"array"}\n${FINDINGS_END_MARKER}`;
    expect(parseFindingsFromJson(body)).toBeNull();
  });

  it("skips items missing required fields", () => {
    const body = `${FINDINGS_START_MARKER}
[
  {"severity":"🔴","title":"Good","filePath":"a.ts","startLine":1,"description":"ok"},
  {"severity":"🔴","title":"Bad"}
]
${FINDINGS_END_MARKER}`;
    const findings = parseFindingsFromJson(body);
    expect(findings!.length).toBe(1);
    expect(findings![0].title).toBe("Good");
  });

  it("cleans up filePath backticks and line references", () => {
    const body = `${FINDINGS_START_MARKER}
[{"severity":"🟡","title":"T","filePath":"\`src/app.ts:L42\`","startLine":42,"description":"d"}]
${FINDINGS_END_MARKER}`;
    const findings = parseFindingsFromJson(body);
    expect(findings![0].filePath).toBe("src/app.ts");
  });

  it("defaults endLine to startLine when not provided", () => {
    const body = `${FINDINGS_START_MARKER}
[{"severity":"🟡","title":"T","filePath":"a.ts","startLine":10,"description":"d"}]
${FINDINGS_END_MARKER}`;
    const findings = parseFindingsFromJson(body);
    expect(findings![0].endLine).toBe(10);
  });

  it("defaults confidence to 70 when not provided", () => {
    const body = `${FINDINGS_START_MARKER}
[{"severity":"🟡","title":"T","filePath":"a.ts","startLine":10,"description":"d"}]
${FINDINGS_END_MARKER}`;
    const findings = parseFindingsFromJson(body);
    expect(findings![0].confidence).toBe(70);
  });
});

// ─── parseFindingsFromMarkdown ──────────────────────────────────────────────

describe("parseFindingsFromMarkdown", () => {
  it("parses legacy markdown findings", () => {
    const body = `## Review
#### 🔴 SQL Injection in API handler
- **File:** \`src/api.ts:L42-L45\`
- **Category:** security
- **Description:** User input is concatenated directly into SQL query
- **Suggestion:**
\`\`\`ts
const result = await db.query("SELECT * FROM users WHERE id = $1", [userId]);
\`\`\`
- **Confidence:** HIGH`;
    const findings = parseFindingsFromMarkdown(body);
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe("🔴");
    expect(findings[0].title).toBe("SQL Injection in API handler");
    expect(findings[0].filePath).toBe("src/api.ts");
    expect(findings[0].startLine).toBe(42);
    expect(findings[0].endLine).toBe(45);
    expect(findings[0].category).toBe("security");
    expect(findings[0].confidence).toBe(90);
  });

  it("handles single line reference (no endLine)", () => {
    const body = `#### 🟡 Missing null check
- **File:** \`src/utils.ts:L10\`
- **Description:** Could be null`;
    const findings = parseFindingsFromMarkdown(body);
    expect(findings[0].startLine).toBe(10);
    expect(findings[0].endLine).toBe(10);
  });

  it("returns empty array for no findings", () => {
    expect(parseFindingsFromMarkdown("no findings here")).toEqual([]);
  });

  it("parses multiple findings", () => {
    const body = `#### 🔴 Bug A
- **File:** \`a.ts:L1\`
- **Description:** Bad
#### 🟡 Style B
- **File:** \`b.ts:L5\`
- **Description:** Meh`;
    const findings = parseFindingsFromMarkdown(body);
    expect(findings.length).toBe(2);
    expect(findings[0].severity).toBe("🔴");
    expect(findings[1].severity).toBe("🟡");
  });
});

// ─── parseFindings ──────────────────────────────────────────────────────────

describe("parseFindings", () => {
  it("prefers JSON format over markdown", () => {
    const body = `#### 🟡 Markdown finding
- **File:** \`x.ts:L1\`
- **Description:** from markdown
${FINDINGS_START_MARKER}
[{"severity":"🔴","title":"JSON finding","filePath":"y.ts","startLine":5,"description":"from json"}]
${FINDINGS_END_MARKER}`;
    const findings = parseFindings(body);
    expect(findings.length).toBe(1);
    expect(findings[0].title).toBe("JSON finding");
  });

  it("falls back to markdown when no JSON", () => {
    const body = `#### 🟡 Only markdown
- **File:** \`x.ts:L1\`
- **Description:** desc`;
    const findings = parseFindings(body);
    expect(findings.length).toBe(1);
    expect(findings[0].title).toBe("Only markdown");
  });
});

// ─── extractKeywords ────────────────────────────────────────────────────────

describe("extractKeywords", () => {
  it("extracts meaningful words, skipping stop words", () => {
    const keywords = extractKeywords("The user input is not sanitized in the handler");
    expect(keywords.has("user")).toBe(true);
    expect(keywords.has("input")).toBe(true);
    expect(keywords.has("sanitized")).toBe(true);
    expect(keywords.has("handler")).toBe(true);
    // Stop words should be excluded
    expect(keywords.has("the")).toBe(false);
    expect(keywords.has("is")).toBe(false);
    expect(keywords.has("not")).toBe(false);
    expect(keywords.has("in")).toBe(false);
  });

  it("lowercases words", () => {
    const keywords = extractKeywords("SQL Injection Attack");
    expect(keywords.has("sql")).toBe(true);
    expect(keywords.has("injection")).toBe(true);
  });

  it("filters short words (<=2 chars)", () => {
    const keywords = extractKeywords("a b cd efg");
    expect(keywords.has("a")).toBe(false);
    expect(keywords.has("b")).toBe(false);
    expect(keywords.has("cd")).toBe(false);
    expect(keywords.has("efg")).toBe(true);
  });

  it("strips non-alphanumeric chars", () => {
    const keywords = extractKeywords("user-input is (unsafe)!");
    expect(keywords.has("user")).toBe(true);
    expect(keywords.has("input")).toBe(true);
    expect(keywords.has("unsafe")).toBe(true);
  });
});

// ─── jaccardSimilarity ─────────────────────────────────────────────────────

describe("jaccardSimilarity", () => {
  it("returns 1 for identical sets", () => {
    const a = new Set(["sql", "injection"]);
    expect(jaccardSimilarity(a, a)).toBe(1);
  });

  it("returns 0 for disjoint sets", () => {
    const a = new Set(["sql", "injection"]);
    const b = new Set(["style", "formatting"]);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it("returns correct ratio for partial overlap", () => {
    const a = new Set(["sql", "injection", "user"]);
    const b = new Set(["sql", "injection", "query"]);
    // intersection=2, union=4, similarity=0.5
    expect(jaccardSimilarity(a, b)).toBe(0.5);
  });

  it("returns 1 for two empty sets", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(1);
  });

  it("returns 0 when one set is empty", () => {
    expect(jaccardSimilarity(new Set(["a"]), new Set())).toBe(0);
  });
});

// ─── deduplicateAgainstPrior ────────────────────────────────────────────────

describe("deduplicateAgainstPrior", () => {
  it("keeps all findings when no prior findings", () => {
    const findings = [
      { severity: "🔴", title: "Bug", filePath: "a.ts", startLine: 10, endLine: 12, category: "", description: "desc", suggestion: "", confidence: 90 },
    ] satisfies InlineFinding[];
    const { kept, removed } = deduplicateAgainstPrior(findings, []);
    expect(kept.length).toBe(1);
    expect(removed.length).toBe(0);
  });

  it("removes duplicate finding (same file, nearby line, similar text)", () => {
    const findings: InlineFinding[] = [
      { severity: "🔴", title: "SQL injection vulnerability", filePath: "src/api.ts", startLine: 42, endLine: 44, category: "security", description: "User input not sanitized for SQL", suggestion: "", confidence: 90 },
    ];
    const priorFindings: PriorFinding[] = [
      { filePath: "src/api.ts", line: 43, title: "SQL injection", keywords: extractKeywords("SQL injection vulnerability User input not sanitized for SQL") },
    ];
    const { kept, removed } = deduplicateAgainstPrior(findings, priorFindings);
    expect(kept.length).toBe(0);
    expect(removed.length).toBe(1);
  });

  it("keeps finding in different file", () => {
    const findings: InlineFinding[] = [
      { severity: "🔴", title: "SQL injection", filePath: "src/api.ts", startLine: 42, endLine: 44, category: "", description: "User input not sanitized", suggestion: "", confidence: 90 },
    ];
    const priorFindings: PriorFinding[] = [
      { filePath: "src/other.ts", line: 42, title: "SQL injection", keywords: extractKeywords("SQL injection User input not sanitized") },
    ];
    const { kept } = deduplicateAgainstPrior(findings, priorFindings);
    expect(kept.length).toBe(1);
  });

  it("keeps finding when lines are far apart", () => {
    const findings: InlineFinding[] = [
      { severity: "🔴", title: "SQL injection", filePath: "src/api.ts", startLine: 100, endLine: 102, category: "", description: "User input not sanitized", suggestion: "", confidence: 90 },
    ];
    const priorFindings: PriorFinding[] = [
      { filePath: "src/api.ts", line: 5, title: "SQL injection", keywords: extractKeywords("SQL injection User input not sanitized") },
    ];
    const { kept } = deduplicateAgainstPrior(findings, priorFindings);
    expect(kept.length).toBe(1);
  });

  it("keeps finding when text is very different", () => {
    const findings: InlineFinding[] = [
      { severity: "🟡", title: "Missing error handling", filePath: "src/api.ts", startLine: 42, endLine: 44, category: "", description: "Promise rejection not caught", suggestion: "", confidence: 70 },
    ];
    const priorFindings: PriorFinding[] = [
      { filePath: "src/api.ts", line: 43, title: "SQL injection", keywords: extractKeywords("SQL injection vulnerability in database query") },
    ];
    const { kept } = deduplicateAgainstPrior(findings, priorFindings);
    expect(kept.length).toBe(1);
  });
});

// ─── parseFindingsFromSummaryTable ──────────────────────────────────────────

describe("parseFindingsFromSummaryTable", () => {
  it("parses findings from summary table rows", () => {
    const body = `| Severity | File | Title | Description |
|----------|------|-------|-------------|
| 🔴 | \`src/api.ts:L42\` | SQL Injection | User input unsanitized |
| 🟡 | \`src/utils.ts:L10\` | Null check | Missing validation |`;
    const findings = parseFindingsFromSummaryTable(body);
    expect(findings.length).toBe(2);
    expect(findings[0].filePath).toBe("src/api.ts");
    expect(findings[0].line).toBe(42);
    expect(findings[0].title).toBe("SQL Injection");
    expect(findings[1].filePath).toBe("src/utils.ts");
    expect(findings[1].line).toBe(10);
  });

  it("returns empty array when no table found", () => {
    expect(parseFindingsFromSummaryTable("no table here")).toEqual([]);
  });

  it("extracts keywords from title and description", () => {
    const body = `| 🔴 | \`a.ts:L1\` | SQL Injection | User input danger |`;
    const findings = parseFindingsFromSummaryTable(body);
    expect(findings[0].keywords.has("sql")).toBe(true);
    expect(findings[0].keywords.has("injection")).toBe(true);
    expect(findings[0].keywords.has("user")).toBe(true);
  });
});
