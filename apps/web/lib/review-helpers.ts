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
import { getCategoryConfidenceThreshold } from "@/lib/review-categories";
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

/**
 * Normalize score denominators in the "### Score" table. The rubric is always
 * x/5, but the model occasionally emits a wrong denominator (e.g. "4/4").
 * Only the Score section is touched so legitimate fractions elsewhere in the
 * review body (e.g. "4/4 tests passed") are preserved.
 */
export function normalizeScoreDenominators(reviewBody: string): string {
  return reviewBody.replace(
    /### Score\s*\n[\s\S]*?(?=\n### |\n## |$)/,
    (section) =>
      section.replace(
        /(\*{0,2})([1-5])\/(\d+)(\*{0,2})/g,
        (match, open: string, score: string, denom: string, close: string) =>
          denom === "5" ? match : `${open}${score}/5${close}`,
      ),
  );
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

  // Escape a value so it is safe inside a Markdown table cell: literal pipes
  // would otherwise close the cell, and newlines would break the row. We keep
  // the FULL text — truncating here (issue #515) leaves no way to read the
  // complete finding, since these findings have no inline comment to expand.
  const tableCell = (text: string) =>
    text.replace(/\|/g, "\\|").replace(/\r?\n+/g, "<br>").trim();

  const toRow = (f: InlineFinding) =>
    `| ${f.severity} | \`${f.filePath}:L${f.startLine}\` | ${tableCell(f.title)} | ${tableCell(f.description)} |`;

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
 *
 * Findings still appear in the PR — they go inline as review comments via
 * `parseFindings(reviewBody)`. This function only controls what's in the
 * main comment thread (where every char counts against GitHub's
 * 65,536-char-per-comment cap).
 *
 * The function is conservative: it strips well-known shapes, then sweeps
 * for things that LOOK like findings even when the model went off-prompt.
 * Comments cite which shape each rule targets so future shapes are easy
 * to add.
 */
export function stripDetailedFindings(reviewBody: string): string {
  let result = reviewBody;

  // 1. JSON findings block (HTML comment delimiters — the documented shape)
  const startIdx = result.indexOf(FINDINGS_START_MARKER);
  const endIdx = result.indexOf(FINDINGS_END_MARKER);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = result.slice(0, startIdx).trimEnd();
    const after = result.slice(endIdx + FINDINGS_END_MARKER.length).trimStart();
    result = before + (after ? "\n\n" + after : "");
  }

  // 2. Stray fenced JSON blocks that look like a findings array.
  //    The prompt says to wrap findings in the HTML-comment markers above,
  //    but verbose models (claude-fable-5, etc.) sometimes also emit a
  //    bare ```json``` fence containing the same array — or, worse, ONLY
  //    the bare fence with no markers. Detect by *shape*, not by keyword
  //    presence alone: the block must (a) be a JSON array, and (b) contain
  //    THREE finding-specific keys — severity, filePath, AND startLine.
  //    Requiring all three avoids stripping unrelated JSON examples that
  //    happen to mention severity or filePath in passing.
  result = result.replace(/\n*```json\s*\n([\s\S]*?)\n```\s*/g, (match, content) => {
    const trimmed = (content as string).trim();
    if (!trimmed.startsWith("[")) return match;
    const hasSeverity = /"severity"\s*:/.test(trimmed);
    const hasFilePath = /"filePath"\s*:/.test(trimmed);
    const hasStartLine = /"startLine"\s*:/.test(trimmed);
    return hasSeverity && hasFilePath && hasStartLine ? "" : match;
  });

  // 3. Legacy <details> "Detailed Findings" block
  result = result.replace(LEGACY_DETAILS_FINDINGS_RX, "");

  // 4. Finding-shaped ### sections — see FINDING_HEADING_WORDS at module
  //    scope for the targeted variants.
  result = result.replace(FINDING_SECTION_H3_RX, "");

  // 5. Individual finding headings emitted in markdown instead of JSON:
  //    "#### Finding #N: ..." or "#### 🔴 ..." (severity emoji).
  //    The /u flag is critical — severity markers (🔴🟠🟡🔵💡) are UTF-16
  //    surrogate pairs and a /u-less character class matches lone
  //    surrogates instead of the actual emoji, leaving these sections
  //    intact. Also drop the trailing `\b` — word boundary is undefined
  //    after an astral codepoint.
  result = result.replace(FINDING_HEADING_H4_RX, "");

  // 6. Trailing "## Findings" / "## Findings (N)" H2 — same off-prompt
  //    pattern at H2 level. Many models default to H2 for top-level
  //    sections when the prompt doesn't say otherwise.
  result = result.replace(FINDING_SECTION_H2_RX, "");

  // Clean up excessive blank lines left behind by stripping
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trimEnd();
}

// Targeted heading variants for rule #4 — the documented shapes ("Detailed
// Findings", "Findings Summary", "Critical Findings") plus the off-prompt
// variants verbose models actually emit. Hoisted to module scope so the
// regex compiles once per process, not per call.
const FINDING_HEADING_WORDS =
  "(?:Detailed Findings|Findings Summary|Critical Findings|Findings(?:\\s+Detail)?|Bugs?|Issues?|Bug Details?|Detailed Issues|Finding Details?)";

const LEGACY_DETAILS_FINDINGS_RX =
  /\n*<details>\s*\n\s*<summary>\s*Detailed Findings\s*<\/summary>[\s\S]*?<\/details>\s*/i;

const FINDING_SECTION_H3_RX = new RegExp(
  `\\n*###\\s+${FINDING_HEADING_WORDS}\\b[\\s\\S]*?(?=\\n###?\\s|\\n## |$)`,
  "gi",
);

const FINDING_HEADING_H4_RX =
  /\n*####\s+(?:Finding\s*#?\d+|[🔴🟠🟡🔵💡])[\s\S]*?(?=\n#{2,4}\s|$)/gu;

const FINDING_SECTION_H2_RX =
  /\n*##\s+Findings(?:\s+\(\d+\))?\b[\s\S]*?(?=\n## |$)/gi;

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

    let body = `**${f.severity} ${f.title}**\n\n${f.description}`;
    if (f.suggestion) {
      // GitHub supports native ```suggestion blocks; Bitbucket uses plain code blocks
      const suggestionBlock = provider === "github"
        ? `\`\`\`suggestion\n${f.suggestion}\n\`\`\``
        : `**Suggested fix:**\n\`\`\`\n${f.suggestion}\n\`\`\``;
      body += `\n\n${suggestionBlock}`;
    }

    // Surface the model's grounding work to the reader. These come from
    // the anti-hallucination fields in the JSON schema (see SYSTEM_PROMPT.md):
    //   - minimumFixScope keeps the suggested fix small and reviewable
    //   - suggestedRegressionTest gives the dev a concrete test to add
    // Without this block the fields only survived in the DB row — the
    // tokens spent on them never reached the user.
    if (f.minimumFixScope || f.suggestedRegressionTest) {
      const groundingParts: string[] = [];
      if (f.minimumFixScope) {
        groundingParts.push(`**Minimum fix scope:** ${f.minimumFixScope}`);
      }
      if (f.suggestedRegressionTest) {
        groundingParts.push(`**Suggested regression test:**\n\`\`\`\n${f.suggestedRegressionTest}\n\`\`\``);
      }
      body += `\n\n<details><summary>📌 Grounding</summary>\n\n${groundingParts.join("\n\n")}\n\n</details>`;
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
    // Fold minimumFixScope into the AI fix prompt too — an assistant
    // running this prompt should respect the bounded change scope, not
    // expand it into a cross-cutting refactor.
    if (f.minimumFixScope) {
      aiPrompt += `\n\nScope: ${f.minimumFixScope}`;
    }
    body += `\n\n<details><summary>🤖 AI Fix Prompt</summary>\n\n\`\`\`\n${aiPrompt}\n\`\`\`\n\n</details>`;

    // Snap note last — it's a footnote-style hint about where the comment
    // landed, not part of the description or suggestion. Keeping it at the
    // bottom keeps the description→suggestion→fix-prompt reading order clean.
    if (snapped) {
      const originalRangeText =
        f.startLine === f.endLine ? `L${f.startLine}` : `L${f.startLine}-L${f.endLine}`;
      body += `\n\n_Note: original finding referenced ${originalRangeText}; attached to nearest changed line (L${targetLine})._`;
    }

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
      if (!seen.has(funcName) && !STOP_WORDS.has(funcName.toLowerCase())) {
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
  /**
   * True when this query checks an existence / "missing X" claim. These must be
   * verified against the ACTUAL file content (not inferred from a possibly
   * truncated diff), so gatherVerificationContext always fetches the full file
   * and searches it for `symbol` rather than relying on Qdrant snippets.
   */
  existence?: boolean;
  /** The symbol the finding claims is missing (route, import, export, handler). */
  symbol?: string;
};

/**
 * Common English stop-words that are never a real code symbol. Used to reject
 * tokens the heuristics would otherwise treat as identifiers (e.g. "missing the
 * handler" must not yield the symbol "the").
 */
const STOP_WORDS = new Set([
  "the", "a", "an", "any", "some", "this", "that", "these", "those",
  "from", "with", "for", "and", "or", "of", "to", "in", "on", "at", "by",
  "it", "its", "their", "is", "are", "be", "been", "proper", "valid",
]);

/** True when a captured token is unusable as a symbol (stop-word or too short). */
function isUnusableSymbol(token: string): boolean {
  return token.length < 3 || STOP_WORDS.has(token.toLowerCase());
}

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
    // Guard against the regex capturing a stop-word ("missing the handler" must
    // not search the file for "the" — that always matches and would wrongly
    // suppress a genuine missing-X finding). Fall through to the generic
    // per-file context query (section 3) when the token is unusable.
    if (missingMatch && f.filePath && !isUnusableSymbol(missingMatch[1])) {
      const missingThing = missingMatch[1];
      queries.push({
        findingIndex: i,
        query: `import ${missingThing} in ${f.filePath}`,
        filePath: f.filePath,
        claim: `Claims "${missingThing}" is missing from ${f.filePath}`,
        existence: true,
        symbol: missingThing,
      });
      // Also search for the thing itself (not just import)
      queries.push({
        findingIndex: i,
        query: `${missingThing} ${f.filePath}`,
        filePath: f.filePath,
        claim: `Verify "${missingThing}" existence in ${f.filePath}`,
        existence: true,
        symbol: missingThing,
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

/**
 * The merge-gating decision: does a review fail its check given the findings'
 * severities and the org's checkFailureThreshold? Single source of truth for
 * both the GitHub check-run conclusion and the GitLab commit status (and the
 * REQUEST_CHANGES review event), so the two providers can never drift.
 * threshold: "none" | "critical" | "high" | "medium".
 */
export function shouldFailReviewCheck(
  sev: { hasCritical: boolean; hasHigh: boolean; hasMedium: boolean },
  threshold: string,
): boolean {
  return (
    threshold !== "none" &&
    (sev.hasCritical ||
      (threshold !== "critical" && sev.hasHigh) ||
      (threshold === "medium" && sev.hasMedium))
  );
}

/** One hit from `searchReviewChunks` (past review summaries in Qdrant). */
export interface PastReviewHit {
  text: string;
  prTitle: string;
  prNumber: number;
  repoFullName: string;
  author: string;
  reviewDate: string;
  score: number;
}

/**
 * Format past reviews on similar code into a compact prompt block. Grounds a
 * review in what Octopus already concluded on related PRs so it stops
 * relitigating settled findings. Pure so it is unit-testable; the caller does
 * the Qdrant query and passes the current PR's identity so we never inject the
 * PR's own prior review back into it (that is the separate re-review context).
 * Returns "" when there is nothing usable, so the placeholder empties cleanly.
 */
export function formatPastReviews(
  hits: PastReviewHit[],
  currentPrNumber: number,
  currentRepoFullName: string,
  opts: { max?: number; minScore?: number; maxCharsPerHit?: number } = {},
): string {
  const { max = 5, minScore = 0.3, maxCharsPerHit = 800 } = opts;
  const usable = hits
    .filter((h) => h.text?.trim())
    .filter((h) => h.score >= minScore)
    // Never echo the current PR's own prior review back at it.
    .filter(
      (h) =>
        !(h.prNumber === currentPrNumber && h.repoFullName === currentRepoFullName),
    )
    .slice(0, max);

  if (usable.length === 0) return "";

  return usable
    .map((h) => {
      const body = h.text.trim().slice(0, maxCharsPerHit);
      const date = h.reviewDate ? ` (${h.reviewDate.slice(0, 10)})` : "";
      return `### ${h.repoFullName}#${h.prNumber} — ${h.prTitle}${date}\n${body}`;
    })
    .join("\n\n---\n\n");
}

/**
 * Build the PR-intent context block from the PR title + description. Gives the
 * reviewer what the change is TRYING to do so it can flag "doesn't accomplish
 * the stated goal", missing-requirement, and scope-creep findings a diff-only
 * reviewer cannot. Extracts linked-issue references (closes/fixes/resolves #N,
 * plus bare #N) from the body so they surface even without fetching each issue.
 * The body is UNTRUSTED (author-controlled) — the prompt marks it so; this
 * helper only bounds length. Returns "" when there is no usable intent.
 */
export function formatPrIntent(
  title: string | null | undefined,
  body: string | null | undefined,
  opts: { maxBodyChars?: number } = {},
): string {
  const { maxBodyChars = 2000 } = opts;
  const t = (title ?? "").trim();
  const b = (body ?? "").trim();
  if (!t && !b) return "";

  const linked = new Set<string>();
  // "closes #12", "fixes #7", "resolves #9" (case-insensitive) and bare "#123".
  for (const m of b.matchAll(/\b(?:close[sd]?|fixe[sd]?|resolve[sd]?)\s+#(\d+)/gi)) {
    linked.add(`#${m[1]}`);
  }
  // Bare refs, including parenthesised/bracketed forms like "(#12)" or "[#12]".
  for (const m of b.matchAll(/(?:^|[\s([])#(\d+)\b/g)) linked.add(`#${m[1]}`);

  const parts: string[] = [];
  if (t) parts.push(`Title: ${t}`);
  if (b) {
    const truncated = b.length > maxBodyChars ? `${b.slice(0, maxBodyChars)}\n…(truncated)` : b;
    parts.push(`Description:\n${truncated}`);
  }
  if (linked.size > 0) parts.push(`Linked issues: ${[...linked].join(", ")}`);
  return parts.join("\n\n");
}

// Common language keywords/stopwords stripped from identifier extraction so the
// retrieval query is weighted toward domain identifiers, not syntax.
const QUERY_STOPWORDS = new Set([
  "const", "let", "var", "function", "return", "import", "export", "from", "class",
  "interface", "type", "async", "await", "else", "while", "switch",
  "case", "break", "continue", "new", "true", "false", "null", "undefined",
  "void", "public", "private", "protected", "static", "extends", "implements",
  "the", "and", "for", "with", "that", "this",
]);

/**
 * Build a semantic retrieval query for a diff WITHOUT embedding the raw +/-
 * churn (which dilutes the embedding and drops files past the old 8k slice).
 * Composes: PR title + every changed file path + `@@` hunk-header context +
 * de-duplicated identifiers from changed lines across the WHOLE diff, bounded so
 * every file is represented regardless of diff size. Pure/testable.
 */
export function buildRetrievalQuery(
  diff: string,
  title: string,
  opts: { maxIdentifiers?: number; maxChars?: number } = {},
): string {
  const { maxIdentifiers = 60, maxChars = 4000 } = opts;
  const lines = diff.split("\n");

  const paths: string[] = [];
  const hunkContexts: string[] = [];
  const identifierCounts = new Map<string, number>();

  for (const line of lines) {
    // New-side file path.
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      paths.push(fileMatch[1]);
      continue;
    }
    // Hunk header: keep the trailing context (usually the enclosing signature).
    const hunkMatch = line.match(/^@@[^@]*@@\s*(.*)$/);
    if (hunkMatch) {
      if (hunkMatch[1].trim()) hunkContexts.push(hunkMatch[1].trim());
      continue;
    }
    // Changed content lines (added/removed), excluding the file headers.
    if ((line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---")) {
      for (const m of line.slice(1).matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) {
        const id = m[0];
        if (QUERY_STOPWORDS.has(id.toLowerCase())) continue;
        identifierCounts.set(id, (identifierCounts.get(id) ?? 0) + 1);
      }
    }
  }

  // Most frequent identifiers first — domain terms that recur across the change.
  const topIdentifiers = [...identifierCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxIdentifiers)
    .map(([id]) => id);

  // Budget each section independently so a path/hunk-heavy diff can't consume the
  // whole char budget and starve the identifiers (the strongest semantic signal).
  // Caps sum to maxChars; identifiers get the largest guaranteed share.
  const identifierBudget = Math.floor(maxChars * 0.55);
  const pathBudget = Math.floor(maxChars * 0.2);
  const hunkBudget = Math.floor(maxChars * 0.2);
  // Leave a small margin for the newline separators so the total stays <= maxChars.
  const titleBudget = Math.max(0, maxChars - identifierBudget - pathBudget - hunkBudget - 4);
  const parts = [
    title.slice(0, titleBudget),
    [...new Set(paths)].join(" ").slice(0, pathBudget),
    hunkContexts.join(" ").slice(0, hunkBudget),
    topIdentifiers.join(" ").slice(0, identifierBudget),
  ].filter((p) => p && p.trim());

  // Per-section budgets already guarantee identifiers their share; the final
  // clamp only trims trailing newline overhead, never a whole section.
  return parts.join("\n").slice(0, maxChars);
}

/** High severities that must be tied to a concrete diff line to keep a high score. */
const HIGH_SEVERITY = new Set(["🔴", "🟠"]);
/** Ceiling for an uncited high-severity finding after adversarial validation (#654). */
export const UNCITED_HIGH_SEV_CAP = 60;

/**
 * A high-severity finding the adversarial validator could not tie to a concrete
 * diff line is suspect — cap its confidence so an uncited 🔴/🟠 can't ride a high
 * self-reported score into the review. All other findings keep the validator's
 * score. Pure so it is unit-testable without the server-only validation module.
 */
export function cappedConfidence(severity: string, confidence: number, hasCitation: boolean): number {
  if (HIGH_SEVERITY.has(severity) && !hasCitation && confidence > UNCITED_HIGH_SEV_CAP) {
    return UNCITED_HIGH_SEV_CAP;
  }
  return confidence;
}

/**
 * Per-category confidence filter — the single source of truth for "does this
 * finding clear the bar", shared by the standard review path (reviewer.ts) and
 * the large-PR path (large-review-result.ts) so the two can't drift (#652).
 * High-risk categories (Security/Bug) get a relaxed threshold via
 * getCategoryConfidenceThreshold. Pure/testable.
 */
export function filterByConfidence(findings: InlineFinding[], baseThreshold = 70): InlineFinding[] {
  return findings.filter(
    (f) => f.confidence >= getCategoryConfidenceThreshold(f.category, baseThreshold),
  );
}
