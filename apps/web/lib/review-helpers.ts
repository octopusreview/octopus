/**
 * Pure helper functions used by the review engine (reviewer.ts).
 * Extracted into a separate module so they can be unit-tested without
 * pulling in heavy server-side dependencies (Prisma, Qdrant, AI SDKs, etc.).
 */

import {
  type InlineFinding,
  FINDINGS_START_MARKER,
  FINDINGS_END_MARKER,
  parseFindingsFromJson,
  extractDiffFiles,
} from "@/lib/review-dedup";
// Re-define the type locally to avoid importing from github.ts (which has side effects in some envs)
export type ReviewComment = {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
  start_line?: number;
};

// ─── Shared Files Detection ─────────────────────────────────────────────────

/** Check if a diff touches shared files (types, utils, config, schema) that warrant conflict detection. */
export function touchesSharedFiles(diff: string): boolean {
  const sharedPatterns = [
    /^diff --git a\/.*(?:types|interfaces|schema|models)\//m,
    /^diff --git a\/.*(?:utils|helpers|shared|common)\//m,
    /^diff --git a\/.*(?:config|\.env|docker|ci)\b/m,
    /^diff --git a\/.*\.d\.ts\b/m,
    /^diff --git a\/.*(?:prisma\/schema|migrations)\//m,
    /^diff --git a\/.*(?:package\.json|tsconfig)/m,
  ];
  return sharedPatterns.some((p) => p.test(diff));
}

// ─── Index Warning ──────────────────────────────────────────────────────────

/** Build a stale-index warning line if the repo's index is degraded. */
export function buildIndexWarning(indexStatus: string): string | null {
  if (indexStatus === "stale" || indexStatus === "failed") {
    return `- **WARNING: This repository's index is ${indexStatus}. Code search results may be outdated or incomplete.**`;
  }
  return null;
}

// ─── Index Claim Resolution ─────────────────────────────────────────────────

export type IndexClaimAction =
  | { action: "run-indexing" }
  | { action: "skip-to-review" }
  | { action: "fail-review"; reason: string };

/**
 * Determine what a waiter process should do after polling for a peer's indexing to complete.
 * Pure decision function -- no side effects.
 */
export function resolveIndexClaimWait(
  peerStatus: string,
  reclaimCount: number,
  finalCheckStatus: string | null,
): IndexClaimAction {
  // Peer succeeded -- no need to index
  if (peerStatus === "indexed") {
    return { action: "skip-to-review" };
  }
  // Peer failed/timed out and we successfully reclaimed
  if (reclaimCount > 0) {
    return { action: "run-indexing" };
  }
  // Could not reclaim -- maybe peer just finished
  if (finalCheckStatus === "indexed") {
    return { action: "skip-to-review" };
  }
  // Cannot index, cannot reclaim -- unrecoverable
  return { action: "fail-review", reason: `indexing failed and could not reclaim (status: ${finalCheckStatus})` };
}

// ─── User Instruction Extraction ────────────────────────────────────────────

export function extractUserInstruction(commentBody: string): string {
  // Match @octopus, @octopusreview, or @octopus-review, then capture everything after
  const match = commentBody.match(/@octopus(?:review|-review)?\b\s*([\s\S]*)/i);
  const raw = match?.[1]?.trim() ?? "";
  // Strip bare "review" keyword that people use to trigger re-reviews
  return raw.replace(/^review\b\s*/i, "").trim();
}

// ─── Finding Counting ───────────────────────────────────────────────────────

/** Count findings in the review body (JSON format first, legacy markdown fallback) */
export function countFindings(reviewBody: string): number {
  const jsonFindings = parseFindingsFromJson(reviewBody);
  if (jsonFindings !== null) return jsonFindings.length;
  const matches = reviewBody.match(/^####\s+(?:🔴|🟠|🟡|🔵|💡)/gm);
  return matches?.length ?? 0;
}

/** Count findings from the Findings Summary table (| EMOJI ... | N |) in the review body */
export function countFindingsFromTable(reviewBody: string): number {
  const rows = reviewBody.match(/\|\s*(?:🔴|🟠|🟡|🔵|💡)\s*[^|]*\|\s*(\d+)\s*\|/gm);
  if (!rows) return 0;
  let total = 0;
  for (const row of rows) {
    const countMatch = row.match(/\|\s*(\d+)\s*\|$/);
    if (countMatch) total += parseInt(countMatch[1], 10);
  }
  return total;
}

// ─── Diff Parsing ───────────────────────────────────────────────────────────

/**
 * Parse a unified diff to get valid (file → line numbers) on the RIGHT side.
 * GitHub Reviews API only accepts comments on lines visible in the diff.
 */
export function parseDiffLines(diff: string): Map<string, Set<number>> {
  const fileLines = new Map<string, Set<number>>();
  let currentFile = "";
  let newLine = 0;

  for (const line of diff.split("\n")) {
    const fileMatch = line.match(/^diff --git a\/(.+?) b\/(.+)/);
    if (fileMatch) {
      currentFile = fileMatch[2];
      if (!fileLines.has(currentFile)) {
        fileLines.set(currentFile, new Set());
      }
      continue;
    }

    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      newLine = parseInt(hunkMatch[1], 10);
      continue;
    }

    if (!currentFile) continue;

    if (line.startsWith("-") && !line.startsWith("---")) {
      // deleted line — don't increment newLine
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      fileLines.get(currentFile)?.add(newLine);
      newLine++;
    } else if (!line.startsWith("\\")) {
      // context line
      fileLines.get(currentFile)?.add(newLine);
      newLine++;
    }
  }

  return fileLines;
}

// ─── Severity & Finding Management ──────────────────────────────────────────

export const MAX_FINDINGS_PER_REVIEW = 30;

export const SEVERITY_PRIORITY: Record<string, number> = {
  "🔴": 0,
  "🟠": 1,
  "🟡": 2,
  "🔵": 3,
  "💡": 4,
};

/** Sort findings by severity priority and cap at max. Returns kept findings and truncated count. */
export function sortAndCapFindings(
  findings: InlineFinding[],
  max: number,
): { kept: InlineFinding[]; truncatedCount: number } {
  const sorted = [...findings].sort(
    (a, b) => (SEVERITY_PRIORITY[a.severity] ?? 99) - (SEVERITY_PRIORITY[b.severity] ?? 99),
  );
  if (sorted.length <= max) return { kept: sorted, truncatedCount: 0 };
  return { kept: sorted.slice(0, max), truncatedCount: sorted.length - max };
}

/** Build summary block for findings that won't get inline comments.
 *  Critical and High severity findings are shown prominently (not collapsed).
 *  Lower severity findings are placed in a collapsed <details> section.
 */
export function buildLowSeveritySummary(findings: InlineFinding[]): string {
  if (findings.length === 0) return "";

  const HIGH_SEVERITIES = ["🔴", "🟠"];
  const highFindings = findings.filter((f) => HIGH_SEVERITIES.includes(f.severity));
  const lowFindings = findings.filter((f) => !HIGH_SEVERITIES.includes(f.severity));

  const buildTable = (rows: string[]) => [
    "| Severity | File | Title | Description |",
    "|----------|------|-------|-------------|",
    ...rows,
  ].join("\n");

  const toRow = (f: InlineFinding) =>
    `| ${f.severity} | \`${f.filePath}:L${f.startLine}\` | ${f.title} | ${f.description.slice(0, 120)}${f.description.length > 120 ? "…" : ""} |`;

  const parts: string[] = [];

  // Critical/High findings are shown prominently (not collapsed)
  if (highFindings.length > 0) {
    const highRows = highFindings.map(toRow);
    parts.push("");
    parts.push(`**${highFindings.map((f) => f.severity).join("")} Findings that could not be mapped to diff lines:**`);
    parts.push("");
    parts.push(buildTable(highRows));
    parts.push("");
  }

  // Lower severity findings go in a collapsed section
  if (lowFindings.length > 0) {
    const lowRows = lowFindings.map(toRow);
    const uniqueSeverities = [...new Set(lowFindings.map((f) => f.severity))];
    const severityIcons = uniqueSeverities.join("");
    parts.push("");
    parts.push("<details>");
    parts.push(`<summary>${severityIcons} Additional findings</summary>`);
    parts.push("");
    parts.push(buildTable(lowRows));
    parts.push("");
    parts.push("</details>");
    parts.push("");
  }

  return parts.join("\n");
}

// ─── Strip Findings ─────────────────────────────────────────────────────────

/**
 * Strip ALL finding-related content from the review body so the main comment
 * contains only the high-level overview (Summary, Score, Risk, Highlights,
 * Important Files, Diagram, Checklist).
 */
export function stripDetailedFindings(reviewBody: string): string {
  let result = reviewBody;

  // 1. JSON findings block (HTML comment delimiters)
  const startIdx = result.indexOf(FINDINGS_START_MARKER);
  const endIdx = result.indexOf(FINDINGS_END_MARKER);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = result.slice(0, startIdx).trimEnd();
    const after = result.slice(endIdx + FINDINGS_END_MARKER.length).trimStart();
    result = before + (after ? "\n\n" + after : "");
  }

  // 2. Legacy <details> "Detailed Findings" block
  result = result.replace(
    /\n*<details>\s*\n\s*<summary>\s*Detailed Findings\s*<\/summary>[\s\S]*?<\/details>\s*/i,
    "",
  );

  // 3. "### Detailed Findings" section — runs until next ### / ## heading or end of string
  result = result.replace(
    /\n*###\s+Detailed Findings\b[\s\S]*?(?=\n###?\s|\n## |$)/gi,
    "",
  );

  // 4. "### Findings Summary" section — runs until next ### / ## heading or end of string
  result = result.replace(
    /\n*###\s+Findings Summary\b[\s\S]*?(?=\n###?\s|\n## |$)/gi,
    "",
  );

  // 5. "### Critical Findings" section (security report mode bleed)
  result = result.replace(
    /\n*###\s+Critical Findings\b[\s\S]*?(?=\n###?\s|\n## |$)/gi,
    "",
  );

  // 6. Individual finding headings: "#### Finding #N: ..." or "#### 🔴/🟠/🟡/🔵/💡 ..."
  //    Each runs until the next #### / ### / ## heading or end of string
  result = result.replace(
    /\n*####\s+(?:Finding\s*#\d+|[🔴🟠🟡🔵💡]\s)\b[\s\S]*?(?=\n#{2,4}\s|$)/g,
    "",
  );

  // Clean up excessive blank lines left behind by stripping
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trimEnd();
}

// ─── Inline Comments ────────────────────────────────────────────────────────

/** Maximum distance (in lines) when snapping a finding to the nearest changed
 *  line in the same file. Beyond this distance the finding falls back to the
 *  summary table instead of being attached inline. */
export const NEAREST_LINE_FALLBACK_RADIUS = 10;

/** Find the changed line in the file closest to a given line number, or null. */
function findNearestChangedLine(
  validLines: Set<number>,
  preferredLine: number,
  radius: number,
): number | null {
  if (validLines.has(preferredLine)) return preferredLine;
  for (let delta = 1; delta <= radius; delta++) {
    if (validLines.has(preferredLine - delta)) return preferredLine - delta;
    if (validLines.has(preferredLine + delta)) return preferredLine + delta;
  }
  return null;
}

/**
 * Convert parsed findings into GitHub review comments, filtering to valid diff lines.
 *
 * Mapping order:
 *   1. Exact match for f.endLine
 *   2. Exact match for f.startLine
 *   3. Any valid line within [startLine, endLine]
 *   4. Nearest changed line within ±NEAREST_LINE_FALLBACK_RADIUS of either
 *      end of the range (snapped). The finding still attaches inline, with a
 *      small note indicating the snap.
 *
 * If none of the above match, the finding is skipped here and ends up in the
 * summary table.
 */
export function buildInlineComments(
  findings: InlineFinding[],
  diffLines: Map<string, Set<number>>,
  provider: string = "github",
): ReviewComment[] {
  const comments: ReviewComment[] = [];

  for (const f of findings) {
    const validLines = diffLines.get(f.filePath);
    if (!validLines) continue;

    // Find a valid line to attach the comment to (prefer endLine, fallback to startLine)
    let targetLine = validLines.has(f.endLine) ? f.endLine : 0;
    if (!targetLine && validLines.has(f.startLine)) {
      targetLine = f.startLine;
    }
    if (!targetLine) {
      // Find the closest valid line within the range
      for (let l = f.endLine; l >= f.startLine; l--) {
        if (validLines.has(l)) {
          targetLine = l;
          break;
        }
      }
    }

    // Fallback: snap to the nearest changed line within ±radius of the range.
    let snapped = false;
    if (!targetLine) {
      const candidate =
        findNearestChangedLine(validLines, f.endLine, NEAREST_LINE_FALLBACK_RADIUS) ??
        findNearestChangedLine(validLines, f.startLine, NEAREST_LINE_FALLBACK_RADIUS);
      if (candidate !== null) {
        targetLine = candidate;
        snapped = true;
      }
    }
    if (!targetLine) continue;

    const originalRangeText =
      f.startLine === f.endLine ? `L${f.startLine}` : `L${f.startLine}-L${f.endLine}`;
    const snapNote = snapped
      ? `\n\n_Note: original finding referenced ${originalRangeText}; attached to nearest changed line (L${targetLine})._`
      : "";

    let body = `**${f.severity} ${f.title}**\n\n${f.description}${snapNote}`;
    if (f.suggestion) {
      // GitHub supports native ```suggestion blocks; Bitbucket uses plain code blocks
      const suggestionBlock = provider === "github"
        ? `\`\`\`suggestion\n${f.suggestion}\n\`\`\``
        : `**Suggested fix:**\n\`\`\`\n${f.suggestion}\n\`\`\``;
      body += `\n\n${suggestionBlock}`;
    }

    // AI Fix Prompt — collapsible section with copy-pasteable prompt
    const severityLabel = f.severity === "🔴" ? "Critical" : f.severity === "🟠" ? "High" : f.severity === "🟡" ? "Medium" : f.severity === "🔵" ? "Low" : "Nit";
    const categoryNote = f.category ? ` (${f.category})` : "";
    const lineRange = f.startLine === f.endLine ? `line ${f.startLine}` : `lines ${f.startLine}-${f.endLine}`;
    let aiPrompt = `Fix the following ${severityLabel}${categoryNote} issue in \`${f.filePath}\` at ${lineRange}:\n\n`;
    aiPrompt += `Problem: ${f.description}`;
    if (f.suggestion) {
      aiPrompt += `\n\nSuggested fix:\n${f.suggestion}`;
    }
    body += `\n\n<details><summary>🤖 AI Fix Prompt</summary>\n\n\`\`\`\n${aiPrompt}\n\`\`\`\n\n</details>`;

    comments.push({
      path: f.filePath,
      line: targetLine,
      side: "RIGHT" as const,
      body,
    });
  }

  return comments;
}

// ─── Review Config ──────────────────────────────────────────────────────────

export type ReviewConfig = {
  maxFindings?: number;
  inlineThreshold?: string; // severity threshold for inline comments: "critical" | "high" | "medium" (default)
  enableConflictDetection?: boolean;
  disabledCategories?: string[];
  confidenceThreshold?: number | string; // numeric 0-100 or legacy "HIGH" | "MEDIUM"
  enableTwoPassReview?: boolean;
};

export function parseReviewConfig(raw: unknown): ReviewConfig {
  if (!raw || typeof raw !== "object") return {};
  return raw as ReviewConfig;
}

/** Merge review configs: system defaults -> org defaults -> repo overrides. Later values win. */
export function mergeReviewConfigs(...configs: ReviewConfig[]): ReviewConfig {
  const merged: ReviewConfig = {};
  for (const cfg of configs) {
    if (cfg.maxFindings !== undefined) merged.maxFindings = cfg.maxFindings;
    if (cfg.inlineThreshold !== undefined) merged.inlineThreshold = cfg.inlineThreshold;
    if (cfg.enableConflictDetection !== undefined) merged.enableConflictDetection = cfg.enableConflictDetection;
    if (cfg.disabledCategories !== undefined) merged.disabledCategories = cfg.disabledCategories;
    if (cfg.confidenceThreshold !== undefined) merged.confidenceThreshold = cfg.confidenceThreshold;
    if (cfg.enableTwoPassReview !== undefined) merged.enableTwoPassReview = cfg.enableTwoPassReview;
  }
  return merged;
}

// ─── Cross-File Reference Extraction ────────────────────────────────────────

export type CrossFileQuery = {
  findingIndex: number;
  query: string;
  filePath?: string;
};

/** Extract cross-file references from findings for Qdrant search / file fetch. */
export function extractCrossFileQueries(findings: InlineFinding[], diff: string): CrossFileQuery[] {
  const diffFiles = extractDiffFiles(diff);
  const queries: CrossFileQuery[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < findings.length; i++) {
    const finding = findings[i];
    const text = `${finding.description} ${finding.suggestion}`;

    // File references in description/suggestion
    for (const match of text.matchAll(
      /(?:in|from|see|check|defined in|imported from)\s+[`"']?([a-zA-Z0-9_\-/.]+\.[a-zA-Z]{1,5})[`"']?/gi,
    )) {
      const filePath = match[1];
      if (!diffFiles.has(filePath) && filePath !== finding.filePath && !seen.has(filePath)) {
        seen.add(filePath);
        queries.push({ findingIndex: i, query: filePath, filePath });
      }
    }

    // Import/require references
    for (const match of text.matchAll(/(?:import|require)\s*\(?\s*["']([^"']+)["']/g)) {
      const filePath = match[1];
      if (!seen.has(filePath)) {
        seen.add(filePath);
        queries.push({ findingIndex: i, query: filePath, filePath });
      }
    }

    // Function/method references: `functionName(params)` pattern
    for (const match of text.matchAll(/[`"](\w+)\s*\([^)]*\)[`"]/g)) {
      const funcName = match[1];
      if (!seen.has(funcName)) {
        seen.add(funcName);
        queries.push({ findingIndex: i, query: funcName });
      }
    }

    // Named function/method references
    for (const match of text.matchAll(/(?:function|method|calls?)\s+[`"]?(\w{3,})[`"]?/gi)) {
      const funcName = match[1];
      if (!seen.has(funcName) && !["the", "this", "that", "from", "with"].includes(funcName.toLowerCase())) {
        seen.add(funcName);
        queries.push({ findingIndex: i, query: funcName });
      }
    }
  }

  return queries.slice(0, 8);
}

// ─── Finding Verification Queries ───────────────────────────────────────────

export type VerificationQuery = {
  findingIndex: number;
  /** Natural-language query to embed and search in Qdrant */
  query: string;
  /** If set, also try to fetch this file directly as fallback */
  filePath?: string;
  /** What the finding claims — used by the validator to check against context */
  claim: string;
};

/**
 * Missing-X patterns: "missing import", "no import", "lacks import",
 * "missing error handling", "missing validation", etc.
 */
const MISSING_PATTERN =
  /\b(?:missing|absent|no|lacks?|without|not (?:imported|defined|declared|included))\b.*?\b(\w[\w./\-@]*)\b/i;

/**
 * Inconsistency patterns: "inconsistent with", "differs from", "unlike other"
 */
const INCONSISTENCY_PATTERN =
  /\b(?:inconsisten|differs? from|unlike|not consistent|asymmetr)/i;

/**
 * Generate targeted verification queries to check whether finding claims are
 * actually true. Unlike extractCrossFileQueries (which only looks at cross-file
 * references), this specifically searches the finding's OWN file to verify
 * claims like "missing import" or "inconsistent pattern".
 */
export function generateVerificationQueries(
  findings: InlineFinding[],
): VerificationQuery[] {
  const queries: VerificationQuery[] = [];

  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const text = `${f.title} ${f.description}`;

    // 1. "Missing X" claims — search the finding's own file for X
    const missingMatch = text.match(MISSING_PATTERN);
    if (missingMatch && f.filePath) {
      const missingThing = missingMatch[1];
      queries.push({
        findingIndex: i,
        query: `import ${missingThing} in ${f.filePath}`,
        filePath: f.filePath,
        claim: `Claims "${missingThing}" is missing from ${f.filePath}`,
      });
      // Also search for the thing itself (not just import)
      queries.push({
        findingIndex: i,
        query: `${missingThing} ${f.filePath}`,
        filePath: f.filePath,
        claim: `Verify "${missingThing}" existence in ${f.filePath}`,
      });
    }

    // 2. Inconsistency claims — search for the pattern in other files
    if (INCONSISTENCY_PATTERN.test(text) && f.filePath) {
      // Extract what the "inconsistent" thing is (usually a function/method name)
      const funcMatch = text.match(/[`"'](\w+)[`"']\s*\(/);
      if (funcMatch) {
        queries.push({
          findingIndex: i,
          query: `${funcMatch[1]} usage pattern`,
          claim: `Claims "${funcMatch[1]}" usage is inconsistent across call sites`,
        });
      }
    }

    // 3. Any finding about a specific file — get that file's imports/header
    //    This catches cases the above patterns miss
    if (f.filePath && !queries.some((q) => q.findingIndex === i)) {
      queries.push({
        findingIndex: i,
        query: `imports and declarations in ${f.filePath}`,
        filePath: f.filePath,
        claim: `General verification context for ${f.filePath}`,
      });
    }
  }

  return queries.slice(0, 15);
}
