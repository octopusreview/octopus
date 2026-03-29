/**
 * Shared dedup & finding-parsing utilities used by both the review engine
 * (reviewer.ts) and the review lifecycle simulator.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type InlineFinding = {
  severity: string;
  title: string;
  filePath: string;
  startLine: number;
  endLine: number;
  category: string;
  description: string;
  suggestion: string;
  confidence: string;
};

export type PriorFinding = {
  filePath: string;
  line: number;
  title: string;
  keywords: Set<string>;
};

// ─── Constants ───────────────────────────────────────────────────────────────

export const FINDINGS_START_MARKER = "<!-- OCTOPUS_FINDINGS_START -->";
export const FINDINGS_END_MARKER = "<!-- OCTOPUS_FINDINGS_END -->";

// ─── Diff Utilities ──────────────────────────────────────────────────────────

/** Extract all file paths touched by a unified diff (using the "b/" side). */
export function extractDiffFiles(diff: string): Set<string> {
  const files = new Set<string>();
  for (const match of diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) {
    files.add(match[2]);
  }
  return files;
}

// ─── Finding Parsers ─────────────────────────────────────────────────────────

/** Parse findings from JSON block (new format). Returns null if not found or unparseable. */
export function parseFindingsFromJson(reviewBody: string): InlineFinding[] | null {
  const startIdx = reviewBody.indexOf(FINDINGS_START_MARKER);
  const endIdx = reviewBody.indexOf(FINDINGS_END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;

  let block = reviewBody.slice(startIdx + FINDINGS_START_MARKER.length, endIdx).trim();

  // Strip markdown code fences if present
  const fenceMatch = block.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    block = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(block);
    if (!Array.isArray(parsed)) return null;

    const findings: InlineFinding[] = [];
    for (const item of parsed) {
      if (
        typeof item.severity !== "string" ||
        typeof item.title !== "string" ||
        typeof item.filePath !== "string" ||
        typeof item.startLine !== "number" ||
        typeof item.description !== "string"
      ) {
        continue;
      }

      findings.push({
        severity: item.severity,
        title: item.title,
        filePath: item.filePath.replace(/^`|`$/g, "").replace(/:L\d+.*$/, ""),
        startLine: item.startLine,
        endLine: typeof item.endLine === "number" ? item.endLine : item.startLine,
        category: item.category ?? "",
        description: item.description,
        suggestion: item.suggestion ?? "",
        confidence: (item.confidence ?? "MEDIUM").toUpperCase(),
      });
    }

    return findings.length > 0 ? findings : null;
  } catch {
    console.warn("[review-dedup] JSON findings block found but failed to parse");
    return null;
  }
}

/** Parse findings from legacy markdown format (#### emoji headings). */
export function parseFindingsFromMarkdown(reviewBody: string): InlineFinding[] {
  const findings: InlineFinding[] = [];
  const parts = reviewBody.split(/^####\s+/m);

  for (const part of parts) {
    if (!part.trim()) continue;

    const severityMatch = part.match(/^(🔴|🟠|🟡|🔵|💡)\s+(.+)/);
    if (!severityMatch) continue;

    const severity = severityMatch[1];
    const title = severityMatch[2].split("\n")[0].trim();

    const fileMatch = part.match(/\*\*File:\*\*\s*`([^`:]+):L(\d+)(?:-L(\d+))?`/);
    if (!fileMatch) continue;

    const filePath = fileMatch[1];
    const startLine = parseInt(fileMatch[2], 10);
    const endLine = fileMatch[3] ? parseInt(fileMatch[3], 10) : startLine;

    const catMatch = part.match(/\*\*Category:\*\*\s*(.+)/);
    const category = catMatch?.[1]?.trim() ?? "";

    const descMatch = part.match(/\*\*Description:\*\*\s*([\s\S]+?)(?=\n-\s*\*\*|$)/);
    const description = descMatch?.[1]?.trim() ?? "";

    const suggMatch = part.match(/\*\*Suggestion:\*\*\s*\n```\w*\n([\s\S]+?)```/);
    const suggestion = suggMatch?.[1]?.trimEnd() ?? "";

    const confMatch = part.match(/\*\*Confidence:\*\*\s*(HIGH|MEDIUM|LOW)/i);
    const confidence = confMatch?.[1]?.toUpperCase() ?? "MEDIUM";

    findings.push({ severity, title, filePath, startLine, endLine, category, description, suggestion, confidence });
  }

  return findings;
}

/** Parse findings: try JSON format first, fall back to legacy markdown. */
export function parseFindings(reviewBody: string): InlineFinding[] {
  const jsonFindings = parseFindingsFromJson(reviewBody);
  if (jsonFindings !== null) return jsonFindings;
  return parseFindingsFromMarkdown(reviewBody);
}

// ─── Keyword & Similarity ────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a", "an", "the", "in", "on", "at", "to", "for", "of", "with", "by", "from",
  "is", "are", "was", "were", "be", "been", "being", "has", "have", "had",
  "do", "does", "did", "will", "would", "could", "should", "may", "might",
  "not", "no", "and", "or", "but", "if", "then", "than", "so", "that", "this",
  "it", "its", "can", "into", "over", "such", "too", "very", "just",
]);

export function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── Deduplication ───────────────────────────────────────────────────────────

/**
 * Hard dedup filter: removes findings that duplicate prior findings.
 * Uses file proximity (same file + nearby line) combined with keyword similarity.
 */
export function deduplicateAgainstPrior(
  findings: InlineFinding[],
  priorFindings: PriorFinding[],
): { kept: InlineFinding[]; removed: InlineFinding[] } {
  if (priorFindings.length === 0) return { kept: findings, removed: [] };

  const LINE_PROXIMITY = 10;
  const KEYWORD_THRESHOLD = 0.30;

  const kept: InlineFinding[] = [];
  const removed: InlineFinding[] = [];

  for (const finding of findings) {
    const findingKeywords = extractKeywords(`${finding.title} ${finding.description}`);

    const isDuplicate = priorFindings.some((prior) => {
      if (prior.filePath !== finding.filePath) return false;
      const lineClose =
        Math.abs(prior.line - finding.startLine) <= LINE_PROXIMITY ||
        Math.abs(prior.line - finding.endLine) <= LINE_PROXIMITY;
      if (!lineClose) return false;
      return jaccardSimilarity(findingKeywords, prior.keywords) >= KEYWORD_THRESHOLD;
    });

    if (isDuplicate) {
      removed.push(finding);
    } else {
      kept.push(finding);
    }
  }

  return { kept, removed };
}

// ─── Summary Table Parser ────────────────────────────────────────────────────

/**
 * Parse findings from a review summary table (the collapsed "Additional findings" block).
 * Matches rows like: | 🟡 | `file.ts:L42` | Title | Description... |
 */
export function parseFindingsFromSummaryTable(reviewBody: string): PriorFinding[] {
  const results: PriorFinding[] = [];
  const rowRegex = /\|\s*(🔴|🟠|🟡|🔵|💡)\s*\|\s*`([^`]+?):L(\d+)`\s*\|\s*([^|]+)\|\s*([^|]*)\|/g;
  let match;
  while ((match = rowRegex.exec(reviewBody)) !== null) {
    const filePath = match[2];
    const line = parseInt(match[3], 10);
    const title = match[4].trim();
    const description = match[5].trim();
    results.push({
      filePath,
      line,
      title,
      keywords: extractKeywords(`${title} ${description}`),
    });
  }
  return results;
}
