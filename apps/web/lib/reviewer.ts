import crypto from "node:crypto";
import { prisma } from "@octopus/db";
import { pubby } from "@/lib/pubby";
import {
  searchSimilarChunks,
  searchKnowledgeChunks,
  ensureReviewCollection,
  upsertReviewChunks,
  deleteReviewChunksByPR,
  ensureDiagramCollection,
  upsertDiagramChunk,
  deleteDiagramChunksByPR,
  searchFeedbackPatterns,
  ensureFeedbackCollection,
  upsertFeedbackPattern,
} from "@/lib/qdrant";
import { extractAllMermaidBlocks, extractNodeLabels, DIAGRAM_TYPE_LABELS } from "@/lib/mermaid-utils";
import { createEmbeddings } from "@/lib/embeddings";
import { generateSparseVector } from "@/lib/sparse-vector";
import { rerankDocuments } from "@/lib/reranker";
import {
  getPullRequestDiff as ghGetPullRequestDiff,
  createPullRequestComment as ghCreatePullRequestComment,
  updatePullRequestComment as ghUpdatePullRequestComment,
  createPullRequestReview as ghCreatePullRequestReview,
  createCheckRun as ghCreateCheckRun,
  updateCheckRun as ghUpdateCheckRun,
  getRepositoryTree as ghGetRepositoryTree,
  getFileContent as ghGetFileContent,
  listReviewComments as ghListReviewComments,
  listPullRequestReviewComments as ghListPullRequestReviewComments,
  listPullRequestIssueComments as ghListPullRequestIssueComments,
  getCommentReactions as ghGetCommentReactions,
} from "@/lib/github";
import * as bitbucket from "@/lib/bitbucket";
import { parseOctopusIgnore, filterDiff, detectBadCommits } from "@/lib/octopus-ignore";
import type { ReviewComment } from "@/lib/github";
import { eventBus } from "@/lib/events";
import { indexRepository } from "@/lib/indexer";
import type { LogLevel } from "@/lib/indexer";
import { summarizeRepository } from "@/lib/summarizer";
import { analyzeRepository } from "@/lib/analyzer";
import { writeSyncLog, deleteSyncLogs } from "@/lib/elasticsearch";
import { logAiUsage } from "@/lib/ai-usage";
import { getReviewModel } from "@/lib/ai-client";
import { createAiMessage, resolveProvider } from "@/lib/ai-router";
import { isOrgOverSpendLimit } from "@/lib/cost";
import fs from "node:fs";
import path from "node:path";

// Load system prompt template once (with diagram rules injected)
let systemPromptTemplate: string | null = null;
let conflictDetectionTemplate: string | null = null;

function getSystemPrompt(): string {
  if (!systemPromptTemplate) {
    const promptsDir = path.join(process.cwd(), "prompts");
    let template = fs.readFileSync(path.join(promptsDir, "SYSTEM_PROMPT.md"), "utf-8");
    const diagramRules = fs.readFileSync(path.join(promptsDir, "DIAGRAM_RULES.md"), "utf-8");
    template = template.replace("{{DIAGRAM_RULES}}", diagramRules);
    systemPromptTemplate = template;
  }
  return systemPromptTemplate;
}

function getConflictDetectionPrompt(): string {
  if (!conflictDetectionTemplate) {
    const promptsDir = path.join(process.cwd(), "prompts");
    conflictDetectionTemplate = fs.readFileSync(path.join(promptsDir, "CONFLICT_DETECTION.md"), "utf-8");
  }
  return conflictDetectionTemplate;
}

/** Check if a diff touches shared files (types, utils, config, schema) that warrant conflict detection. */
function touchesSharedFiles(diff: string): boolean {
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

function extractUserInstruction(commentBody: string): string {
  // Match @octopus or @octopus-review, then capture everything after
  const match = commentBody.match(/@octopus(?:-review)?\b\s*([\s\S]*)/i);
  const raw = match?.[1]?.trim() ?? "";
  // Strip bare "review" keyword that people use to trigger re-reviews
  return raw.replace(/^review\b\s*/i, "").trim();
}

/** Count unique files changed in a unified diff */
function countDiffFiles(diff: string): number {
  return extractDiffFiles(diff).size;
}

/** Extract all file paths touched by a unified diff (using the "b/" side). */
function extractDiffFiles(diff: string): Set<string> {
  const files = new Set<string>();
  for (const match of diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) {
    files.add(match[2]);
  }
  return files;
}

/** Count findings in the review body (JSON format first, legacy markdown fallback) */
function countFindings(reviewBody: string): number {
  const jsonFindings = parseFindingsFromJson(reviewBody);
  if (jsonFindings !== null) return jsonFindings.length;
  const matches = reviewBody.match(/^####\s+(?:🔴|🟠|🟡|🔵|💡)/gm);
  return matches?.length ?? 0;
}

/** Count findings from the Findings Summary table (| EMOJI ... | N |) in the review body */
function countFindingsFromTable(reviewBody: string): number {
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
 * Parse a unified diff to get valid (file → line numbers) on the RIGHT side.
 * GitHub Reviews API only accepts comments on lines visible in the diff.
 */
function parseDiffLines(diff: string): Map<string, Set<number>> {
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

type InlineFinding = {
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

const MAX_FINDINGS_PER_REVIEW = 30;

const SEVERITY_PRIORITY: Record<string, number> = {
  "🔴": 0,
  "🟠": 1,
  "🟡": 2,
  "🔵": 3,
  "💡": 4,
};

/** Sort findings by severity priority and cap at max. Returns kept findings and truncated count. */
function sortAndCapFindings(
  findings: InlineFinding[],
  max: number,
): { kept: InlineFinding[]; truncatedCount: number } {
  const sorted = [...findings].sort(
    (a, b) => (SEVERITY_PRIORITY[a.severity] ?? 99) - (SEVERITY_PRIORITY[b.severity] ?? 99),
  );
  if (sorted.length <= max) return { kept: sorted, truncatedCount: 0 };
  return { kept: sorted.slice(0, max), truncatedCount: sorted.length - max };
}

/** Build a collapsed summary block for findings that won't get inline comments. */
function buildLowSeveritySummary(findings: InlineFinding[]): string {
  if (findings.length === 0) return "";
  const rows = findings.map(
    (f) => `| ${f.severity} | \`${f.filePath}:L${f.startLine}\` | ${f.title} | ${f.description.slice(0, 120)}${f.description.length > 120 ? "…" : ""} |`,
  );
  const uniqueSeverities = [...new Set(findings.map((f) => f.severity))];
  const severityIcons = uniqueSeverities.join("");
  return [
    "",
    "<details>",
    `<summary>${severityIcons} Additional findings</summary>`,
    "",
    "| Severity | File | Title | Description |",
    "|----------|------|-------|-------------|",
    ...rows,
    "",
    "</details>",
    "",
  ].join("\n");
}

const FINDINGS_START_MARKER = "<!-- OCTOPUS_FINDINGS_START -->";
const FINDINGS_END_MARKER = "<!-- OCTOPUS_FINDINGS_END -->";

/** Parse findings from JSON block (new format). Returns null if not found or unparseable. */
function parseFindingsFromJson(reviewBody: string): InlineFinding[] | null {
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
    console.warn("[reviewer] JSON findings block found but failed to parse");
    return null;
  }
}

/** Parse findings from legacy markdown format (#### emoji headings). */
function parseFindingsFromMarkdown(reviewBody: string): InlineFinding[] {
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
function parseFindings(reviewBody: string): InlineFinding[] {
  const jsonFindings = parseFindingsFromJson(reviewBody);
  if (jsonFindings !== null) {
    console.log(`[reviewer] Parsed ${jsonFindings.length} findings from JSON block`);
    return jsonFindings;
  }
  const mdFindings = parseFindingsFromMarkdown(reviewBody);
  if (mdFindings.length > 0) {
    console.log(`[reviewer] Parsed ${mdFindings.length} findings from legacy markdown format`);
  }
  return mdFindings;
}

/**
 * Strip the findings block from the review body.
 * Handles both JSON (HTML comment delimiters) and legacy (<details>) formats.
 */
function stripDetailedFindings(reviewBody: string): string {
  // New format: HTML comment delimiters
  const startIdx = reviewBody.indexOf(FINDINGS_START_MARKER);
  const endIdx = reviewBody.indexOf(FINDINGS_END_MARKER);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = reviewBody.slice(0, startIdx).trimEnd();
    const after = reviewBody.slice(endIdx + FINDINGS_END_MARKER.length).trimStart();
    return before + (after ? "\n\n" + after : "");
  }

  // Legacy format: <details> block
  return reviewBody.replace(
    /\n*<details>\s*\n\s*<summary>\s*Detailed Findings\s*<\/summary>[\s\S]*?<\/details>\s*/i,
    "",
  );
}

/**
 * Convert parsed findings into GitHub review comments, filtering to valid diff lines.
 */
function buildInlineComments(
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
    if (!targetLine) continue;

    let body = `**${f.severity} ${f.title}**\n\n${f.description}`;
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

type ReviewConfig = {
  maxFindings?: number;
  inlineThreshold?: string; // severity threshold for inline comments: "critical" | "high" | "medium" (default)
  enableConflictDetection?: boolean;
  disabledCategories?: string[];
  confidenceThreshold?: string; // "HIGH" | "MEDIUM" (default)
  enableTwoPassReview?: boolean;
};

function parseReviewConfig(raw: unknown): ReviewConfig {
  if (!raw || typeof raw !== "object") return {};
  return raw as ReviewConfig;
}

/** Merge review configs: system defaults -> org defaults -> repo overrides. Later values win. */
function mergeReviewConfigs(...configs: ReviewConfig[]): ReviewConfig {
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

/** Validate findings with a second LLM pass. Returns only the findings that pass validation. */
async function validateFindings(
  findings: InlineFinding[],
  diff: string,
  orgId: string,
  model: string,
): Promise<InlineFinding[]> {
  if (findings.length === 0) return findings;

  const findingsSummary = findings
    .map((f, i) => `[${i}] ${f.severity} ${f.title}\nFile: ${f.filePath}:L${f.startLine}\nDescription: ${f.description}`)
    .join("\n\n");

  const response = await createAiMessage(
    {
      model,
      maxTokens: 2048,
      messages: [
        {
          role: "user",
          content: `You are a senior code reviewer validating findings from an automated review. For each finding below, determine if it is a genuine issue based on the diff provided.

FINDINGS:
${findingsSummary}

DIFF:
\`\`\`diff
${diff.slice(0, 12000)}
\`\`\`

For each finding, respond with ONLY a JSON array of verdicts:
[{"index": 0, "verdict": "KEEP"}, {"index": 1, "verdict": "DISCARD"}, ...]

KEEP = the finding is a real, actionable issue visible in the diff
DISCARD = the finding is speculative, a false positive, or not supported by the diff

Output ONLY the JSON array, nothing else.`,
        },
      ],
    },
    orgId,
  );

  await logAiUsage({
    provider: response.provider,
    model,
    operation: "review-validation",
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    cacheReadTokens: response.usage.cacheReadTokens,
    cacheWriteTokens: response.usage.cacheWriteTokens,
    organizationId: orgId,
  });

  try {
    const jsonMatch = response.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return findings;
    const verdicts = JSON.parse(jsonMatch[0]) as { index: number; verdict: string }[];
    const keepIndexes = new Set(
      verdicts.filter((v) => v.verdict === "KEEP").map((v) => v.index),
    );
    const validated = findings.filter((_, i) => keepIndexes.has(i));
    console.log(`[reviewer] Two-pass validation: ${validated.length}/${findings.length} findings kept`);
    return validated;
  } catch {
    console.warn("[reviewer] Failed to parse two-pass validation response, keeping all findings");
    return findings;
  }
}

type ReviewEvent = {
  repoId: string;
  pullRequestId: string;
  number: number;
  status: "reviewing" | "completed" | "failed";
  step:
    | "started"
    | "fetching-diff"
    | "searching-context"
    | "generating-review"
    | "posting-comment"
    | "completed"
    | "failed";
  detail?: string;
  error?: string;
};

async function emitReviewStatus(orgId: string, event: ReviewEvent) {
  await pubby
    .trigger(`presence-org-${orgId}`, "review-status", event)
    .catch((err) =>
      console.error("[reviewer] Pubby trigger failed:", err),
    );
}

// --- Pre-review feedback sync helpers ---

const DISMISSAL_PATTERNS = [
  /\bfalse\s*positive\b/i,
  /\bnot\s*(a\s*)?bug\b/i,
  /\bintentional(ly)?\b/i,
  /\bnot\s*applicable\b/i,
  /\bn\/?a\b/i,
  /\bby\s*design\b/i,
  /\bwon'?t\s*fix\b/i,
  /\bignore\s*this\b/i,
  /\bnot\s*(an?\s*)?issue\b/i,
  /\bworking\s*as\s*(intended|expected|designed)\b/i,
  /👎/,
  /:-1:/,
];

const ACCEPTANCE_PATTERNS = [
  /👍/,
  /:\+1:/,
];

function isDismissalReply(body: string): boolean {
  return DISMISSAL_PATTERNS.some((p) => p.test(body));
}

function isAcceptanceReply(body: string): boolean {
  return ACCEPTANCE_PATTERNS.some((p) => p.test(body));
}

/**
 * Normalize a finding title for fuzzy matching.
 * Strips severity emojis, backtick contents, and collapses whitespace.
 */
function normalizeFindingTitle(title: string): string {
  return title
    .replace(/[🔴🟠🟡🔵💡]/g, "")
    .replace(/`[^`]+`/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Parse per-finding feedback from a structured comment body.
 * Recognizes lines like:
 *   - 🟡 **Finding title** — 👍 Explanation
 *   - 🔵 **Finding title** — 👎 Reason
 *
 * Returns null if the comment doesn't contain per-finding feedback format.
 */
function parsePerFindingFeedback(body: string): { title: string; feedback: "up" | "down" }[] | null {
  const lines = body.split("\n");
  const results: { title: string; feedback: "up" | "down" }[] = [];

  for (const line of lines) {
    // Match lines with bold title and 👍/👎 feedback
    const titleMatch = line.match(/\*\*(.+?)\*\*/);
    if (!titleMatch) continue;

    const title = titleMatch[1].trim();
    // Check the part after the title for feedback signals
    const afterTitle = line.slice(line.indexOf(titleMatch[0]) + titleMatch[0].length);

    if (DISMISSAL_PATTERNS.some((p) => p.test(afterTitle))) {
      results.push({ title, feedback: "down" });
    } else if (ACCEPTANCE_PATTERNS.some((p) => p.test(afterTitle))) {
      results.push({ title, feedback: "up" });
    }
  }

  return results.length > 0 ? results : null;
}

async function embedFeedbackPattern(
  issue: { id: string; title: string; description: string; severity: string; pullRequest: { repositoryId: string; repository: { organizationId: string } } },
  feedback: "up" | "down",
) {
  await ensureFeedbackCollection();
  const text = `${issue.title} ${issue.description}`;
  const [vector] = await createEmbeddings([text], {
    organizationId: issue.pullRequest.repository.organizationId,
    operation: "embedding",
  });
  await upsertFeedbackPattern({
    id: issue.id,
    vector,
    sparseVector: generateSparseVector(text),
    payload: {
      title: issue.title,
      description: issue.description,
      severity: issue.severity,
      feedback,
      repoId: issue.pullRequest.repositoryId,
      orgId: issue.pullRequest.repository.organizationId,
    },
  });
}

/**
 * Sync GitHub reactions (👍/👎) on previous review comments before re-review.
 * Scoped to a single PR for speed.
 */
async function syncReactionsForPR(
  installationId: number,
  owner: string,
  repoName: string,
  pullRequestId: string,
) {
  const issues = await prisma.reviewIssue.findMany({
    where: {
      pullRequestId,
      githubCommentId: { not: null },
      feedback: null,
    },
    select: {
      id: true,
      title: true,
      description: true,
      severity: true,
      githubCommentId: true,
      pullRequest: {
        select: {
          repositoryId: true,
          repository: { select: { organizationId: true } },
        },
      },
    },
  });

  if (issues.length === 0) return;

  let synced = 0;
  for (const issue of issues) {
    const commentId = Number(issue.githubCommentId);
    if (isNaN(commentId)) continue;

    try {
      const reactions = await ghGetCommentReactions(installationId, owner, repoName, commentId);
      if (reactions.thumbsUp > 0 || reactions.thumbsDown > 0) {
        const vote = reactions.thumbsUp >= reactions.thumbsDown ? "up" : "down";
        await prisma.reviewIssue.update({
          where: { id: issue.id },
          data: { feedback: vote, feedbackAt: new Date(), feedbackBy: "github-reaction" },
        });
        await embedFeedbackPattern(issue, vote);
        synced++;
      }
    } catch (err) {
      console.error(`[reviewer] Failed to sync reaction for issue ${issue.id}:`, err);
    }
  }

  if (synced > 0) {
    console.log(`[reviewer] Synced ${synced} GitHub reactions for PR ${pullRequestId}`);
  }
}

/**
 * Scan reply comments on previous review inline comments for dismissal/acceptance signals.
 * If a reply says "false positive", "👎", etc., mark as "down". If "👍", mark as "up".
 *
 * Also scans general PR issue comments for per-finding feedback (lines like
 * "**Title** — 👎 reason" or "**Title** — 👍 addressed"). Falls back to bulk
 * dismiss if no per-finding format is detected but dismissal keywords exist.
 */
async function syncTextDismissalsForPR(
  installationId: number,
  owner: string,
  repoName: string,
  prNumber: number,
  pullRequestId: string,
  prAuthor: string,
) {
  const issues = await prisma.reviewIssue.findMany({
    where: {
      pullRequestId,
      feedback: null,
    },
    select: {
      id: true,
      title: true,
      description: true,
      severity: true,
      createdAt: true,
      githubCommentId: true,
      pullRequest: {
        select: {
          repositoryId: true,
          repository: { select: { organizationId: true } },
        },
      },
    },
  });

  if (issues.length === 0) return;

  let synced = 0;
  const dismissedIds = new Set<string>();

  // --- Part 1: Scan inline review comment replies (threaded dismissals) ---
  const issuesWithCommentId = issues.filter((i) => i.githubCommentId !== null);
  if (issuesWithCommentId.length > 0) {
    const allReviewComments = await ghListPullRequestReviewComments(installationId, owner, repoName, prNumber);

    // Build map: parent comment ID → reply bodies
    const repliesByParent = new Map<number, string[]>();
    for (const comment of allReviewComments) {
      if (comment.inReplyToId) {
        const replies = repliesByParent.get(comment.inReplyToId) ?? [];
        replies.push(comment.body);
        repliesByParent.set(comment.inReplyToId, replies);
      }
    }

    for (const issue of issuesWithCommentId) {
      const commentId = Number(issue.githubCommentId);
      if (isNaN(commentId)) continue;

      const replies = repliesByParent.get(commentId);
      if (!replies) continue;

      const hasDismissal = replies.some(isDismissalReply);
      const hasAcceptance = !hasDismissal && replies.some(isAcceptanceReply);
      if (!hasDismissal && !hasAcceptance) continue;

      const vote = hasDismissal ? "down" : "up";
      try {
        await prisma.reviewIssue.update({
          where: { id: issue.id },
          data: { feedback: vote, feedbackAt: new Date(), feedbackBy: "github-reply-dismissal" },
        });
        await embedFeedbackPattern(issue, vote);
        dismissedIds.add(issue.id);
        synced++;
      } catch (err) {
        console.error(`[reviewer] Failed to record text feedback for issue ${issue.id}:`, err);
      }
    }
  }

  // --- Part 2: Scan general PR issue comments for per-finding or bulk feedback ---
  // Supports two modes:
  // (a) Per-finding: comment has lines like "**Title** — 👎 reason" → match to specific findings
  // (b) Bulk dismiss: comment has dismissal keywords but no per-finding format → dismiss ALL
  const remainingIssues = issues.filter((i) => !dismissedIds.has(i.id));

  if (remainingIssues.length > 0) {
    const issueComments = await ghListPullRequestIssueComments(installationId, owner, repoName, prNumber);

    // Only consider comments from the PR author, posted AFTER the findings were created
    const oldestFinding = remainingIssues.reduce(
      (min, i) => (i.createdAt < min ? i.createdAt : min),
      remainingIssues[0].createdAt,
    );
    const relevantComments = issueComments.filter(
      (c) => c.user === prAuthor && new Date(c.createdAt) > oldestFinding,
    );

    // Build normalized title → issue mapping for per-finding matching
    const issuesByNormalizedTitle = new Map<string, typeof remainingIssues>();
    for (const issue of remainingIssues) {
      const key = normalizeFindingTitle(issue.title);
      const existing = issuesByNormalizedTitle.get(key) ?? [];
      existing.push(issue);
      issuesByNormalizedTitle.set(key, existing);
    }

    const bulkDismissComments: typeof relevantComments = [];

    for (const comment of relevantComments) {
      const perFinding = parsePerFindingFeedback(comment.body);

      if (perFinding) {
        // Per-finding mode: match each feedback line to specific findings
        for (const { title, feedback } of perFinding) {
          const normalizedTitle = normalizeFindingTitle(title);
          const matched = issuesByNormalizedTitle.get(normalizedTitle);
          if (!matched) continue;

          for (const issue of matched) {
            if (dismissedIds.has(issue.id)) continue;
            try {
              await prisma.reviewIssue.update({
                where: { id: issue.id },
                data: { feedback, feedbackAt: new Date(), feedbackBy: "github-issue-comment-per-finding" },
              });
              await embedFeedbackPattern(issue, feedback);
              dismissedIds.add(issue.id);
              synced++;
            } catch (err) {
              console.error(`[reviewer] Failed to record per-finding feedback for issue ${issue.id}:`, err);
            }
          }
        }
      } else {
        // No per-finding format — candidate for bulk dismiss
        bulkDismissComments.push(comment);
      }
    }

    // Fallback: bulk dismiss for comments that didn't have per-finding format
    {
      const stillRemaining = remainingIssues.filter((i) => !dismissedIds.has(i.id));
      const hasDismissalComment = bulkDismissComments.some((c) => isDismissalReply(c.body));

      if (hasDismissalComment && stillRemaining.length > 0) {
        const remainingIds = stillRemaining.map((i) => i.id);
        const { count } = await prisma.reviewIssue.updateMany({
          where: { id: { in: remainingIds } },
          data: { feedback: "down", feedbackAt: new Date(), feedbackBy: "github-issue-comment-dismissal" },
        });
        synced += count;

        for (const issue of stillRemaining) {
          try {
            await embedFeedbackPattern(issue, "down");
          } catch (err) {
            console.error(`[reviewer] Failed to embed feedback pattern for issue ${issue.id}:`, err);
          }
        }
        console.log(`[reviewer] Dismissed ${count} findings via bulk issue comment dismissal`);
      }
    }
  }

  if (synced > 0) {
    console.log(`[reviewer] Synced ${synced} text dismissals for PR ${pullRequestId}`);
  }
}

export async function processReview(pullRequestId: string): Promise<void> {
  // Load PR with repo and org info
  const pr = await prisma.pullRequest.findUnique({
    where: { id: pullRequestId },
    include: {
      repository: {
        include: { organization: true },
      },
    },
  });

  if (!pr) {
    console.error(`[reviewer] PullRequest not found: ${pullRequestId}`);
    return;
  }

  const repo = pr.repository;
  const org = repo.organization;

  // 3-tier config: system defaults -> org defaults -> repo overrides
  let systemConfig: ReviewConfig = {};
  try {
    const sysRow = await prisma.systemConfig.findUnique({ where: { id: "singleton" } });
    if (sysRow) systemConfig = parseReviewConfig(sysRow.defaultReviewConfig);
  } catch { /* table may not exist yet */ }
  const orgConfig = parseReviewConfig(org.defaultReviewConfig);
  const repoConfig = parseReviewConfig(repo.reviewConfig);
  const reviewConfig = mergeReviewConfigs(systemConfig, orgConfig, repoConfig);

  if (org.reviewsPaused) {
    console.log(`[reviewer] Reviews paused for org ${org.id}, skipping PR ${pr.id}`);
    return;
  }

  const isGitHub = repo.provider === "github";
  const isBitbucket = repo.provider === "bitbucket";
  const installationId = repo.installationId ?? org.githubInstallationId;

  if (isGitHub && !installationId) {
    console.error(`[reviewer] No GitHub installation for repo: ${repo.id}`);
    return;
  }

  const [owner, repoName] = repo.fullName.split("/");

  // Provider-aware helper functions
  const providerGetDiff = (prNumber: number) =>
    isGitHub
      ? ghGetPullRequestDiff(installationId!, owner, repoName, prNumber)
      : bitbucket.getPullRequestDiff(org.id, owner, repoName, prNumber);

  const providerCreateComment = (prNumber: number, body: string) =>
    isGitHub
      ? ghCreatePullRequestComment(installationId!, owner, repoName, prNumber, body)
      : bitbucket.createPullRequestComment(org.id, owner, repoName, prNumber, body);

  const providerUpdateComment = async (commentId: number, body: string) => {
    try {
      if (isGitHub) {
        await ghUpdatePullRequestComment(installationId!, owner, repoName, commentId, body);
      } else {
        await bitbucket.updatePullRequestComment(org.id, owner, repoName, pr.number, commentId, body);
      }
    } catch (err) {
      // If the comment was deleted externally, create a new one and update the reference
      if (err instanceof Error && err.message.includes("404")) {
        console.warn(`[reviewer] Comment ${commentId} not found (deleted?), creating new comment`);
        const newId = await providerCreateComment(pr.number, body);
        reviewCommentId = newId;
        await prisma.pullRequest.update({
          where: { id: pr.id },
          data: { reviewCommentId: newId },
        });
        return;
      }
      throw err;
    }
  };

  const providerGetTree = (branch: string) =>
    isGitHub
      ? ghGetRepositoryTree(installationId!, owner, repoName, branch)
      : bitbucket.getRepositoryTree(org.id, owner, repoName, branch);
  let reviewCommentId = pr.reviewCommentId ? Number(pr.reviewCommentId) : null;
  const baseEvent = {
    repoId: repo.id,
    pullRequestId: pr.id,
    number: pr.number,
  };

  // Create check run if we have a head SHA (GitHub only — Bitbucket has no checks API)
  let checkRunId: number | null = null;
  if (pr.headSha && isGitHub && installationId) {
    try {
      checkRunId = await ghCreateCheckRun(
        installationId,
        owner,
        repoName,
        pr.headSha,
        "Octopus Review",
      );
      console.log(`[reviewer] Check run created — id: ${checkRunId}`);

      // Clear permission flag if it was previously set
      if (org.needsPermissionGrant) {
        await prisma.organization.update({
          where: { id: org.id },
          data: { needsPermissionGrant: false },
        });
        console.log(`[reviewer] Permission grant flag cleared for org: ${org.id}`);
      }
    } catch (err) {
      console.error("[reviewer] Failed to create check run:", err);

      // 403 means the GitHub App needs new permissions accepted
      if (err instanceof Error && err.message.includes("403")) {
        await prisma.organization.update({
          where: { id: org.id },
          data: { needsPermissionGrant: true },
        }).catch((e) => console.error("[reviewer] Failed to set permission flag:", e));
        console.warn(`[reviewer] Permission grant needed for org: ${org.id}`);
      }
    }
  }

  // Pre-review: sync feedback from GitHub before generating new findings
  if (isGitHub && installationId) {
    try {
      await syncReactionsForPR(installationId, owner, repoName, pr.id);
      await syncTextDismissalsForPR(installationId, owner, repoName, pr.number, pr.id, pr.author);
    } catch (err) {
      console.warn("[reviewer] Pre-review feedback sync failed, continuing:", err);
    }
  }

  try {
    // Phase 0: Auto-index & analyze if repository hasn't been indexed yet
    if (repo.indexStatus !== "indexed") {
      console.log(`[reviewer] Repository ${repo.fullName} not indexed (status: ${repo.indexStatus}). Starting auto-index...`);

      // 0a. Update placeholder comment — indexing
      if (reviewCommentId) {
        await providerUpdateComment(
          reviewCommentId,
          "> 🐙 **Octopus Review** — This repository hasn't been indexed yet.\n>\n> Indexing in progress... this may take a few minutes. (Step 1/3)",
        );
      }

      // 0b. Run indexing (with real-time logs via Pubby + Elasticsearch)
      const indexChannel = `presence-org-${org.id}`;

      await deleteSyncLogs(org.id, repo.id);

      await prisma.repository.update({
        where: { id: repo.id },
        data: { indexStatus: "indexing" },
      });

      pubby.trigger(indexChannel, "index-status", {
        repoId: repo.id,
        status: "indexing",
      }).catch((err) => console.error("[reviewer] Pubby index-status trigger failed:", err));

      const emitIndexLog = (message: string, level: LogLevel = "info") => {
        const timestamp = Date.now();
        pubby.trigger(indexChannel, "index-log", {
          repoId: repo.id,
          message,
          level,
          timestamp,
        }).catch((err) => console.error("[reviewer] Pubby index-log trigger failed:", err));
        writeSyncLog({
          orgId: org.id,
          repoId: repo.id,
          message,
          level,
          timestamp,
        });
      };

      const indexStats = await indexRepository(
        repo.id,
        repo.fullName,
        repo.defaultBranch,
        installationId ?? 0,
        emitIndexLog,
        undefined,
        repo.provider,
        repo.organizationId,
      );

      // 0c. Update DB with index results
      await prisma.repository.update({
        where: { id: repo.id },
        data: {
          indexStatus: "indexed",
          indexedAt: new Date(),
          indexedFiles: indexStats.indexedFiles,
          totalFiles: indexStats.totalFiles,
          totalChunks: indexStats.totalChunks,
          totalVectors: indexStats.totalVectors,
          indexDurationMs: indexStats.durationMs,
          contributorCount: indexStats.contributorCount,
          contributors: JSON.parse(JSON.stringify(indexStats.contributors)),
        },
      });

      emitIndexLog(`Indexing complete: ${indexStats.indexedFiles} files, ${indexStats.totalVectors} vectors`, "success");

      pubby.trigger(indexChannel, "index-status", {
        repoId: repo.id,
        status: "indexed",
      }).catch((err) => console.error("[reviewer] Pubby index-status trigger failed:", err));

      console.log(`[reviewer] Indexing complete: ${indexStats.indexedFiles} files, ${indexStats.totalVectors} vectors`);

      // 0d. Update placeholder comment — analyzing
      if (reviewCommentId) {
        await providerUpdateComment(
          reviewCommentId,
          `> 🐙 **Octopus Review** — Indexing complete ✓ (${indexStats.indexedFiles} files, ${indexStats.totalVectors} vectors).\n>\n> Analyzing repository... (Step 2/3)`,
        );
      }

      // 0e. Summarize repository
      const { summary, purpose } = await summarizeRepository(repo.id, repo.fullName, org.id);
      await prisma.repository.update({
        where: { id: repo.id },
        data: { summary, purpose },
      });

      console.log(`[reviewer] Summary complete: ${purpose}`);

      // 0f. Analyze repository
      await prisma.repository.update({
        where: { id: repo.id },
        data: { analysisStatus: "analyzing" },
      });

      pubby.trigger(indexChannel, "analysis-status", {
        repoId: repo.id,
        status: "analyzing",
      }).catch((err) => console.error("[reviewer] Pubby analysis-status trigger failed:", err));

      const analysis = await analyzeRepository(repo.id, repo.fullName, org.id);
      await prisma.repository.update({
        where: { id: repo.id },
        data: {
          analysis,
          analysisStatus: "analyzed",
          analyzedAt: new Date(),
        },
      });

      pubby.trigger(indexChannel, "analysis-status", {
        repoId: repo.id,
        status: "analyzed",
      }).catch((err) => console.error("[reviewer] Pubby analysis-status trigger failed:", err));

      console.log(`[reviewer] Analysis complete`);

      // 0g. Update placeholder comment — ready for review
      if (reviewCommentId) {
        await providerUpdateComment(
          reviewCommentId,
          "> 🐙 **Octopus Review** — Repository indexed and analyzed ✓.\n>\n> Starting PR review... (Step 3/3)",
        );
      }

      // 0h. Enable auto-review for this repo
      await prisma.repository.update({
        where: { id: repo.id },
        data: { autoReview: true },
      });

      // 0i. Emit Pubby events for dashboard updates
      await pubby.trigger(`presence-org-${org.id}`, "repo-indexed", {
        repoId: repo.id,
        fullName: repo.fullName,
        indexedFiles: indexStats.indexedFiles,
        totalVectors: indexStats.totalVectors,
      }).catch((err) => console.error("[reviewer] Pubby repo-indexed trigger failed:", err));

      eventBus.emit({
        type: "repo-indexed",
        orgId: org.id,
        repoFullName: repo.fullName,
        success: true,
        indexedFiles: indexStats.indexedFiles,
        totalVectors: indexStats.totalVectors,
        durationMs: indexStats.durationMs,
      });

      await pubby.trigger(`presence-org-${org.id}`, "repo-analyzed", {
        repoId: repo.id,
        fullName: repo.fullName,
      }).catch((err) => console.error("[reviewer] Pubby repo-analyzed trigger failed:", err));

      eventBus.emit({
        type: "repo-analyzed",
        orgId: org.id,
        repoFullName: repo.fullName,
      });

      console.log(`[reviewer] Phase 0 complete — ${repo.fullName} indexed, analyzed, auto-review enabled`);
    }

    // Resolve the model to use for this org (with repo-level override)
    const reviewModel = await getReviewModel(org.id, repo.id);
    console.log(`[reviewer] Using model: ${reviewModel}`);

    // Spend limit check
    const overLimit = await isOrgOverSpendLimit(org.id);
    if (overLimit) {
      console.warn(`[reviewer] Org ${org.id} is over spend limit — skipping review`);
      const limitMsg = "> 🐙 **Octopus Review** — Your organization has reached its monthly AI usage limit.\n>\n> Please add your own API keys in Settings to continue receiving reviews.";
      if (reviewCommentId) {
        await providerUpdateComment(reviewCommentId, limitMsg);
      } else {
        await providerCreateComment(pr.number, limitMsg);
      }
      await prisma.pullRequest.update({
        where: { id: pr.id },
        data: { status: "failed", errorMessage: "Monthly spend limit reached" },
      });
      return;
    }

    // Step 1: Mark as reviewing
    await prisma.pullRequest.update({
      where: { id: pr.id },
      data: { status: "reviewing" },
    });
    await emitReviewStatus(org.id, {
      ...baseEvent,
      status: "reviewing",
      step: "started",
    });

    // Step 2: Fetch diff from GitHub
    await emitReviewStatus(org.id, {
      ...baseEvent,
      status: "reviewing",
      step: "fetching-diff",
    });

    const [rawDiff, repoTree] = await Promise.all([
      providerGetDiff(pr.number),
      providerGetTree(repo.defaultBranch),
    ]);

    // Detect committed build artifacts / dependency folders
    const badFiles = detectBadCommits(rawDiff);
    if (badFiles.length > 0) {
      console.log(`[reviewer] Detected ${badFiles.length} build artifact / dependency files in diff`);
    }

    // Fetch .octopusignore if it exists in the repo
    let diff = rawDiff;
    let octopusIg: ReturnType<typeof parseOctopusIgnore> | undefined;
    if (repoTree.includes(".octopusignore")) {
      try {
        const ignoreContent = isGitHub && installationId
          ? await ghGetFileContent(installationId, owner, repoName, repo.defaultBranch, ".octopusignore")
          : isBitbucket
            ? await bitbucket.getFileContent(org.id, owner, repoName, repo.defaultBranch, ".octopusignore")
            : null;

        if (ignoreContent) {
          octopusIg = parseOctopusIgnore(ignoreContent);
          diff = filterDiff(diff, octopusIg);
          console.log(`[reviewer] Applied .octopusignore — diff reduced from ${rawDiff.length} to ${diff.length} chars`);
        }
      } catch (err) {
        console.warn("[reviewer] Failed to fetch .octopusignore, continuing without it:", err);
      }
    }

    const diffFiles = extractDiffFiles(diff);
    const filesChanged = diffFiles.size;

    // Merge PR diff files into the repo tree so new files added by the PR
    // are visible in the file tree — prevents false positives about "missing" modules.
    const treeSet = new Set(repoTree);
    for (const f of diffFiles) treeSet.add(f);
    const mergedTree = treeSet.size > repoTree.length ? Array.from(treeSet) : repoTree;

    console.log(`[reviewer] Diff fetched: ${diff.length} chars, ${filesChanged} files, tree: ${mergedTree.length} files (${mergedTree.length - repoTree.length} added from diff)`);

    // Early exit: no reviewable changes
    if (!diff.trim()) {
      const emptyMsg = [
        "> 🐙 **Octopus Review** skipped this pull request.",
        ">",
        "> The diff is empty — there are no reviewable code changes. This can happen when:",
        "> - The PR contains only merge commits with no new changes",
        "> - All changed files are excluded by `.octopusignore`",
        "> - The PR branch is already up to date with the base branch",
        ">",
        "> If you believe this is a mistake, please update the PR and comment `@octopus` to retry.",
      ].join("\n");

      if (reviewCommentId) {
        await providerUpdateComment(reviewCommentId, emptyMsg);
      } else {
        await providerCreateComment(pr.number, emptyMsg);
      }

      if (checkRunId && isGitHub && installationId) {
        await ghUpdateCheckRun(installationId, owner, repoName, checkRunId, "neutral", {
          title: "No reviewable changes",
          summary: "The diff is empty — there are no reviewable code changes.",
        });
      }

      console.log(`[reviewer] Skipped PR #${pr.number} — empty diff`);
      return;
    }

    // Step 3: Embed diff → semantic search for codebase context
    await emitReviewStatus(org.id, {
      ...baseEvent,
      status: "reviewing",
      step: "searching-context",
    });

    // Take first 8000 chars of diff as search query
    const searchText = diff.slice(0, 8000);
    const [queryVector] = await createEmbeddings([searchText], {
      organizationId: org.id,
      operation: "embedding",
      repositoryId: repo.id,
    });

    // Over-fetch from Qdrant, then rerank with Cohere
    const rerankQuery = `${pr.title}\n${diff.slice(0, 2000)}`;

    const [rawCodeChunks, rawKnowledgeChunks] = await Promise.all([
      searchSimilarChunks(repo.id, queryVector, 50, rerankQuery),
      searchKnowledgeChunks(org.id, queryVector, 25, rerankQuery).catch(() => [] as { title: string; text: string; score: number }[]),
    ]);

    const [contextChunks, knowledgeChunks] = await Promise.all([
      rerankDocuments(rerankQuery, rawCodeChunks, {
        topK: 15,
        scoreThreshold: 0.25,
        minResults: 3,
        organizationId: org.id,
        operation: "review-rerank",
      }),
      rerankDocuments(rerankQuery, rawKnowledgeChunks, {
        topK: 8,
        scoreThreshold: 0.20,
        minResults: 1,
        organizationId: org.id,
        operation: "review-rerank",
      }),
    ]);

    const codebaseContext = contextChunks
      .map(
        (c) =>
          `// ${c.filePath}:L${c.startLine}-L${c.endLine}\n${c.text}`,
      )
      .join("\n\n---\n\n");

    const knowledgeContext = knowledgeChunks.length > 0
      ? knowledgeChunks.map((c) => c.text).join("\n\n---\n\n")
      : "";

    await emitReviewStatus(org.id, {
      ...baseEvent,
      status: "reviewing",
      step: "searching-context",
      detail: `${contextChunks.length}/${rawCodeChunks.length} code chunks after rerank, ${knowledgeChunks.length}/${rawKnowledgeChunks.length} knowledge chunks after rerank`,
    });

    console.log(
      `[reviewer] Context: ${contextChunks.length}/${rawCodeChunks.length} code chunks, ${knowledgeChunks.length}/${rawKnowledgeChunks.length} knowledge chunks (after rerank)`,
    );

    // Step 4: Build prompt and call Anthropic
    await emitReviewStatus(org.id, {
      ...baseEvent,
      status: "reviewing",
      step: "generating-review",
    });

    const userInstruction = extractUserInstruction(
      pr.triggerCommentBody,
    );

    // Fetch past feedback (disliked = false positive, liked = valuable) for this repo
    // Aggregate into compact patterns instead of dumping raw findings
    let falsePositiveContext = "";
    try {
      const feedbackIssues = await prisma.reviewIssue.findMany({
        where: {
          feedback: { not: null },
          pullRequest: { repositoryId: repo.id },
        },
        select: {
          title: true,
          severity: true,
          feedback: true,
        },
        orderBy: { feedbackAt: "desc" },
        take: 200,
      });

      if (feedbackIssues.length > 0) {
        // Group by feedback type + normalized title to deduplicate
        const normalize = (t: string) => t.replace(/`[^`]+`/g, "...").replace(/\s+/g, " ").trim().toLowerCase();
        const groups = new Map<string, { title: string; severity: string; count: number; feedback: string }>();

        for (const issue of feedbackIssues) {
          const key = `${issue.feedback}:${normalize(issue.title)}`;
          const existing = groups.get(key);
          if (existing) {
            existing.count++;
          } else {
            groups.set(key, { title: issue.title, severity: issue.severity, count: 1, feedback: issue.feedback! });
          }
        }

        // Sort by count (most frequent feedback first), take top patterns
        const sorted = [...groups.values()].sort((a, b) => b.count - a.count);
        const disliked = sorted.filter((g) => g.feedback === "down").slice(0, 10);
        const liked = sorted.filter((g) => g.feedback === "up").slice(0, 5);

        const parts: string[] = [];
        if (disliked.length > 0) {
          parts.push(
            "FALSE POSITIVES (the team marked these as unhelpful — do NOT repeat similar findings):",
            ...disliked.map((g) => `- "${g.title}" (${g.count}x, ${g.severity})`),
          );
        }
        if (liked.length > 0) {
          parts.push(
            "",
            "VALUED FINDINGS (the team found these helpful — prioritize similar patterns):",
            ...liked.map((g) => `- "${g.title}" (${g.count}x, ${g.severity})`),
          );
        }

        if (parts.length > 0) {
          falsePositiveContext = parts.join("\n");
          console.log(`[reviewer] Feedback context: ${disliked.length} false positive patterns, ${liked.length} valued patterns (from ${feedbackIssues.length} total feedback)`);
        }
      }
    } catch (err) {
      console.warn("[reviewer] Failed to fetch feedback context:", err);
    }

    // Fetch prior review comments once — shared by prompt context injection and inline dedup.
    const appSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG ?? "octopus-review";
    const botLogin = `${appSlug}[bot]`;
    let allPriorReviewComments: import("@/lib/github").PRReviewComment[] = [];
    if (isGitHub && installationId) {
      try {
        allPriorReviewComments = await ghListPullRequestReviewComments(installationId, owner, repoName, pr.number);
      } catch (err) {
        console.warn("[reviewer] Failed to fetch prior review comments:", err);
      }
    }

    // Detect re-review: if the bot already has inline comments or a previous reviewBody,
    // this is a follow-up review. Inject prior findings and change the review strategy.
    let priorReviewContext = "";
    const botComments = allPriorReviewComments.filter((c) => !c.inReplyToId && c.user === botLogin && c.line != null);
    const isReReview = botComments.length > 0 || !!pr.reviewBody;

    if (isReReview) {
      const parts: string[] = [
        "RE-REVIEW MODE: This PR has already been reviewed. Your priority is to verify whether previously raised findings have been addressed. Follow these rules strictly:",
        "1. Do NOT raise new findings unless they are critical severity (🔴) or were clearly introduced by changes made since the last review.",
        "2. Do NOT rephrase, reframe, or re-raise previously dismissed findings from a different angle.",
        "3. Focus on confirming fixes: check if the code changes actually resolve the issues you previously raised.",
        "4. If all previous findings are addressed and no critical new issues exist, keep the findings list empty.",
      ];

      if (botComments.length > 0) {
        const summaries = botComments.map((c) => {
          const firstLine = c.body.split("\n")[0].replace(/\*\*/g, "").trim();
          return `- ${c.path}:${c.line} — ${firstLine}`;
        });
        parts.push(
          "",
          "PRIOR INLINE COMMENTS (already posted — do NOT repeat):",
          ...summaries,
        );
      }

      priorReviewContext = parts.join("\n");
      console.log(`[reviewer] Re-review detected: ${botComments.length} prior inline comments, injecting re-review instructions`);
    }

    const FILE_TREE_IGNORE = [
      // JS/TS ecosystem
      "node_modules/", "dist/", "build/", ".next/", ".nuxt/",
      ".svelte-kit/", ".output/", ".turbo/", ".cache/",
      // C# / .NET
      "bin/", "obj/", "packages/", ".vs/",
      // Java / Kotlin
      "target/", ".gradle/", ".mvn/",
      // Python
      "__pycache__/", ".venv/", "venv/", ".tox/", ".mypy_cache/",
      // Go / Rust
      "vendor/",
      // IDE / editor configs
      ".vscode/", ".idea/", ".eclipse/", ".settings/",
      // Git / CI artifacts
      ".git/", "coverage/",
      // Lock files
      "package-lock.json", "bun.lock", "yarn.lock", "pnpm-lock.yaml",
    ];
    const MAX_TREE_FILES = 2000;

    const filteredTree = mergedTree
      .filter((p) => !FILE_TREE_IGNORE.some((ig) => p.includes(ig)))
      .filter((p) => !octopusIg?.ignores(p));
    const fileTree = filteredTree.length > MAX_TREE_FILES
      ? filteredTree.slice(0, MAX_TREE_FILES).join("\n") + `\n... and ${filteredTree.length - MAX_TREE_FILES} more files`
      : filteredTree.join("\n");

    const enableConflict = reviewConfig.enableConflictDetection !== undefined
      ? reviewConfig.enableConflictDetection
      : touchesSharedFiles(diff);
    const conflictPrompt = enableConflict ? getConflictDetectionPrompt() : "";
    const systemPrompt = getSystemPrompt()
      .replace("{{CODEBASE_CONTEXT}}", codebaseContext)
      .replace("{{FILE_TREE}}", fileTree)
      .replace("{{KNOWLEDGE_CONTEXT}}", knowledgeContext)
      .replace("{{PR_NUMBER}}", String(pr.number))
      .replace("{{USER_INSTRUCTION}}", userInstruction)
      .replace("{{PROVIDER}}", isGitHub ? "GitHub" : isBitbucket ? "Bitbucket" : repo.provider)
      .replace("{{FALSE_POSITIVE_CONTEXT}}", [falsePositiveContext, priorReviewContext].filter(Boolean).join("\n\n"))
      .replace("{{CONFLICT_DETECTION}}", conflictPrompt);

    const response = await createAiMessage(
      {
        model: reviewModel,
        maxTokens: 8192,
        system: systemPrompt,
        cacheSystem: true,
        messages: [
          {
            role: "user",
            content: `Review the following Pull Request diff:\n\n**PR #${pr.number}: ${pr.title}**\nAuthor: ${pr.author}\n${userInstruction ? `\nUser instruction: ${userInstruction}\n` : ""}\n\`\`\`diff\n${diff}\n\`\`\``,
          },
        ],
      },
      org.id,
    );

    // Fix malformed mermaid block closings:
    // 1. Content on same line before closing ```: "unchanged```" → "unchanged\n```"
    let reviewBody = response.text.replace(/([^\n])```(\n|$)/g, "$1\n```$2");
    // 2. ``` merged with next line: "```### Checklist" → "```\n\n### Checklist"
    //    Only match ``` followed by non-language-tag chars to preserve ```mermaid etc.
    reviewBody = reviewBody.replace(/```([^`\n\sa-z])/g, "```\n\n$1");

    // Prepend build artifact warning if bad files were detected in the diff
    if (badFiles.length > 0) {
      const badFilesSection = [
        "#### 🔴 Critical: Build artifacts / dependency folders committed",
        "",
        "The following files should NOT be committed to the repository. Add them to `.gitignore` and remove them from version control:",
        "",
        ...badFiles.slice(0, 20).map((f) => `- \`${f}\``),
        badFiles.length > 20 ? `- ... and ${badFiles.length - 20} more` : "",
        "",
      ].filter(Boolean).join("\n");
      reviewBody = badFilesSection + "\n\n" + reviewBody;
    }

    await logAiUsage({
      provider: response.provider,
      model: reviewModel,
      operation: "review",
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      cacheReadTokens: response.usage.cacheReadTokens,
      cacheWriteTokens: response.usage.cacheWriteTokens,
      organizationId: org.id,
    });

    const findingsCount = countFindings(reviewBody);
    console.log(`[reviewer] Review generated: ${reviewBody.length} chars, ${findingsCount} findings`);

    // Step 5: Post review to PR
    await emitReviewStatus(org.id, {
      ...baseEvent,
      status: "reviewing",
      step: "posting-comment",
    });

    // 5a: Update placeholder (or create new) with review body (findings stripped — they go inline)
    const mainCommentBody = stripDetailedFindings(reviewBody);

    if (reviewCommentId) {
      await providerUpdateComment(reviewCommentId, mainCommentBody);
      console.log(`[reviewer] Placeholder comment updated — commentId: ${reviewCommentId}`);
    } else {
      const newCommentId = await providerCreateComment(pr.number, mainCommentBody);
      reviewCommentId = newCommentId;
      await prisma.pullRequest.update({
        where: { id: pr.id },
        data: { reviewCommentId: newCommentId },
      });
      console.log(`[reviewer] New review comment created — commentId: ${newCommentId}`);
    }

    // 5b: Parse findings and submit inline review comments
    let findings = parseFindings(reviewBody);
    let effectiveReviewBody = reviewBody;

    // Debug: log whether JSON or markdown markers were found
    const hasJsonMarkers = reviewBody.includes(FINDINGS_START_MARKER);
    const hasLegacyMarkers = /<details>\s*\n\s*<summary>\s*Detailed Findings/i.test(reviewBody);
    console.log(`[reviewer] Findings parse result: ${findings.length} findings (jsonMarkers=${hasJsonMarkers}, legacyMarkers=${hasLegacyMarkers})`);

    // Fallback: if Findings Summary table count exceeds parsed findings,
    // make a follow-up call to extract the missing findings
    const tableFindingsTotal = countFindingsFromTable(reviewBody);
    const hasMissingFindings = tableFindingsTotal > 0 && findings.length < tableFindingsTotal;
    if (hasMissingFindings) {
      const missingCount = tableFindingsTotal - findings.length;
      console.warn(`[reviewer] ⚠️ Findings table reports ${tableFindingsTotal} but only ${findings.length} parsed (${missingCount} missing) — requesting findings via follow-up call`);
      try {
          const followUp = await createAiMessage(
            {
              model: reviewModel,
              maxTokens: 4096,
              messages: [
                {
                  role: "user",
                  content: `You previously wrote this code review but ${findings.length === 0 ? "omitted the findings block" : `only included ${findings.length} of ${tableFindingsTotal} findings`}. The Findings Summary table shows ${tableFindingsTotal} total findings.

Here is the review you wrote:
${reviewBody}

Now output ONLY the ${findings.length === 0 ? "missing findings" : `${missingCount} missing finding(s)`} as a JSON array. Each finding must have this exact structure:

[
  {
    "severity": "🔴",
    "title": "Issue title",
    "filePath": "path/to/file.ts",
    "startLine": 42,
    "endLine": 58,
    "category": "Bug",
    "description": "Clear explanation of the issue",
    "suggestion": "suggested fix code or empty string",
    "confidence": "HIGH"
  }
]

Rules:
- severity: one of 🔴 🟠 🟡 🔵 💡
- filePath: relative path only, no backticks, no :L suffix
- startLine/endLine: integers
- confidence: HIGH or MEDIUM only
- Output ONLY valid JSON array. No markdown, no explanation, no code fences.`,
                },
              ],
            },
            org.id,
          );

          const findingsBlock = followUp.text;

          await logAiUsage({
            provider: followUp.provider,
            model: reviewModel,
            operation: "review-findings-followup",
            inputTokens: followUp.usage.inputTokens,
            outputTokens: followUp.usage.outputTokens,
            cacheReadTokens: followUp.usage.cacheReadTokens,
            cacheWriteTokens: followUp.usage.cacheWriteTokens,
            organizationId: org.id,
          });

          // Try JSON parse first (requested format), then markdown fallback
          const wrappedBlock = `${FINDINGS_START_MARKER}\n${findingsBlock}\n${FINDINGS_END_MARKER}`;
          let followUpFindings = parseFindingsFromJson(wrappedBlock);
          if (!followUpFindings) {
            // Try direct JSON parse (AI may omit markers but output valid JSON)
            try {
              const fenceMatch = findingsBlock.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
              const raw = fenceMatch ? fenceMatch[1].trim() : findingsBlock.trim();
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) {
                followUpFindings = parseFindingsFromJson(`${FINDINGS_START_MARKER}\n\`\`\`json\n${JSON.stringify(parsed)}\n\`\`\`\n${FINDINGS_END_MARKER}`);
              }
            } catch {
              // Final fallback: legacy markdown parser
              followUpFindings = parseFindingsFromMarkdown(findingsBlock);
              if (followUpFindings.length === 0) followUpFindings = null;
            }
          }
          if (followUpFindings && followUpFindings.length > 0) {
            // Merge: add only findings not already present (by file+title dedup)
            const existingKeys = new Set(findings.map((f) => `${f.filePath}:${f.title}`));
            const newFindings = followUpFindings.filter((f) => !existingKeys.has(`${f.filePath}:${f.title}`));
            findings = [...findings, ...newFindings];
            // Append findings block to reviewBody so it gets stored in DB
            effectiveReviewBody = `${reviewBody}\n\n${FINDINGS_START_MARKER}\n\`\`\`json\n${JSON.stringify(followUpFindings, null, 2)}\n\`\`\`\n${FINDINGS_END_MARKER}`;
            console.log(`[reviewer] Follow-up recovered ${newFindings.length} new findings (${followUpFindings.length} total from follow-up, ${findings.length} combined) (provider: ${repo.provider}, pr: #${pr.number})`);
          } else {
            console.warn(`[reviewer] Follow-up also returned no parseable findings (provider: ${repo.provider}, pr: #${pr.number})`);
          }
        } catch (err) {
          console.error("[reviewer] Follow-up findings call failed:", err);
        }
    }

    // Save all parsed findings before filtering — these will be shown in the summary comment
    let allParsedFindings = [...findings];

    // Filter out findings below confidence threshold
    const confidenceThreshold = reviewConfig.confidenceThreshold ?? "MEDIUM";
    const allFindings = findings;
    if (confidenceThreshold === "HIGH") {
      findings = findings.filter((f) => f.confidence === "HIGH");
    } else {
      // Default: filter out LOW
      findings = findings.filter((f) => f.confidence !== "LOW");
    }
    if (allFindings.length !== findings.length) {
      console.log(`[reviewer] Filtered out ${allFindings.length - findings.length} findings below confidence threshold (${confidenceThreshold})`);
    }

    // Filter out disabled categories
    if (reviewConfig.disabledCategories && reviewConfig.disabledCategories.length > 0) {
      const disabled = new Set(reviewConfig.disabledCategories.map((c) => c.toLowerCase()));
      const before = findings.length;
      findings = findings.filter((f) => !disabled.has(f.category.toLowerCase()));
      if (findings.length !== before) {
        console.log(`[reviewer] Filtered out ${before - findings.length} findings from disabled categories`);
      }
    }

    // Semantic feedback matching: suppress findings that match known false positive patterns
    try {
      await ensureFeedbackCollection();

      // Build texts for ALL parsed findings (used for both inline filtering and summary filtering)
      const allFindingTexts = allParsedFindings.map((f) => `${f.title} ${f.description}`);
      if (allFindingTexts.length > 0) {
        const allFindingVectors = await createEmbeddings(allFindingTexts, {
          organizationId: org.id,
          operation: "embedding",
          repositoryId: repo.id,
        });

        const suppressedAllIndexes = new Set<number>();
        for (let i = 0; i < allParsedFindings.length; i++) {
          const matches = await searchFeedbackPatterns(repo.id, allFindingVectors[i], 3, org.id, allFindingTexts[i]);
          const falsePositiveMatch = matches.find(
            (m) => m.feedback === "down" && m.score > 0.85,
          );
          if (falsePositiveMatch) {
            suppressedAllIndexes.add(i);
          }
        }

        if (suppressedAllIndexes.size > 0) {
          // Filter allParsedFindings so dismissed findings don't appear in the summary table
          allParsedFindings = allParsedFindings.filter((_, i) => !suppressedAllIndexes.has(i));

          // Also filter the inline findings list using the same suppressed set mapped to current findings
          const suppressedFindingKeys = new Set(
            [...suppressedAllIndexes].map((i) => allFindingTexts[i]),
          );
          const beforeCount = findings.length;
          findings = findings.filter((f) => !suppressedFindingKeys.has(`${f.title} ${f.description}`));

          const totalSuppressed = suppressedAllIndexes.size;
          const inlineSuppressed = beforeCount - findings.length;
          console.log(`[reviewer] Suppressed ${totalSuppressed} findings via semantic feedback matching (${inlineSuppressed} inline, ${totalSuppressed - inlineSuppressed} summary-only)`);
        }
      }
    } catch (err) {
      console.warn("[reviewer] Semantic feedback matching failed, continuing:", err);
    }

    // Two-pass validation: use a second LLM call to validate findings (feature flag)
    const enableTwoPass = reviewConfig.enableTwoPassReview || process.env.ENABLE_TWO_PASS_REVIEW === "true";
    if (enableTwoPass && findings.length > 0) {
      try {
        findings = await validateFindings(findings, diff, org.id, reviewModel);
      } catch (err) {
        console.warn("[reviewer] Two-pass validation failed, keeping all findings:", err);
      }
    }

    // Cap findings to top N by severity
    const maxFindings = reviewConfig.maxFindings ?? MAX_FINDINGS_PER_REVIEW;
    const { kept: cappedFindings, truncatedCount } = sortAndCapFindings(findings, maxFindings);
    findings = cappedFindings;
    if (truncatedCount > 0) {
      console.log(`[reviewer] Capped findings: showing ${findings.length} of ${findings.length + truncatedCount}`);
    }

    // Split findings: inline (above threshold) vs summary-only (below threshold)
    const inlineThreshold = reviewConfig.inlineThreshold ?? "medium";
    const inlineSeverities = inlineThreshold === "critical"
      ? ["🔴"]
      : inlineThreshold === "high"
        ? ["🔴", "🟠"]
        : ["🔴", "🟠", "🟡"]; // default: medium
    const inlineFindings = findings.filter((f) => inlineSeverities.includes(f.severity));

    console.log(`[reviewer] Split: ${inlineFindings.length} inline (${inlineSeverities.join(",")}), severities: ${findings.map((f) => f.severity).join(",")}`);

    const diffLines = parseDiffLines(diff);
    const inlineComments = buildInlineComments(inlineFindings, diffLines, repo.provider);
    console.log(`[reviewer] Built ${inlineComments.length} inline comments from ${inlineFindings.length} inline findings`);

    // Use findings.length as the authoritative count (accounts for follow-up recovery)
    // Fall back to findings summary table count if both parsed findings and regex count are 0
    const tableFindingsCount = countFindingsFromTable(reviewBody);
    const effectiveFindingsCount = allParsedFindings.length || findingsCount || tableFindingsCount;

    console.log(`[reviewer] Parsed ${allParsedFindings.length} total, ${findings.length} after filters, ${inlineComments.length} inline comments`);

    const hasCritical = findings.some((f) => f.severity === "🔴") || badFiles.length > 0;
    const hasHigh = findings.some((f) => f.severity === "🟠");
    const hasMedium = findings.some((f) => f.severity === "🟡");

    const threshold = org.checkFailureThreshold || "critical";
    const shouldRequestChanges =
      threshold !== "none" && (
        hasCritical ||
        (threshold !== "critical" && hasHigh) ||
        (threshold === "medium" && hasMedium)
      );
    const reviewEvent = shouldRequestChanges ? "REQUEST_CHANGES" : "COMMENT";

    // Build the review summary body with non-inline findings embedded
    const buildReviewSummary = (findingsBlock: string) => {
      const header = `${filesChanged} file${filesChanged !== 1 ? "s" : ""} reviewed, ${effectiveFindingsCount} finding${effectiveFindingsCount !== 1 ? "s" : ""}`;
      const parts = [header];
      if (findingsBlock) parts.push(findingsBlock);
      parts.push("[Octopus Review](https://github.com/apps/octopus-review)");
      return parts.join("\n\n");
    };

    // Determine which findings go into the review summary (non-inline ones)
    let inlineReviewSucceeded = false;

    if (isGitHub && installationId) {
      // GitHub: use the PR review API for inline comments
      if (inlineComments.length > 0) {
        // Dedup: skip inline comments where the bot already posted on the same file+line
        const existingLocations = new Set(
          allPriorReviewComments
            .filter((c) => !c.inReplyToId && c.line != null && c.user === botLogin)
            .map((c) => `${c.path}:${c.line}`),
        );
        const dedupedComments = inlineComments.filter((c) => !existingLocations.has(`${c.path}:${c.line}`));
        if (dedupedComments.length < inlineComments.length) {
          console.log(`[reviewer] Deduped inline comments: ${inlineComments.length} → ${dedupedComments.length} (${inlineComments.length - dedupedComments.length} already posted)`);
        }

        // First, figure out the collapsed block for the summary (we need it before posting)
        // Include ALL inline locations (both new and already-posted) so they don't leak into summary
        const allInlinePaths = new Set(inlineComments.map((c) => `${c.path}:${c.line}`));
        const nonInlineFindings = allParsedFindings.filter((f) => {
          for (let l = f.startLine; l <= f.endLine; l++) {
            if (allInlinePaths.has(`${f.filePath}:${l}`)) return false;
          }
          return true;
        });
        const findingsBlock = buildLowSeveritySummary(nonInlineFindings);
        const summaryLine = buildReviewSummary(findingsBlock);

        try {
          const reviewId = await ghCreatePullRequestReview(
            installationId, owner, repoName, pr.number,
            summaryLine, reviewEvent as "COMMENT" | "REQUEST_CHANGES", dedupedComments,
          );
          inlineReviewSucceeded = true;
          console.log(`[reviewer] PR review submitted with ${dedupedComments.length} inline comments, ${nonInlineFindings.length} in summary (${reviewEvent}), reviewId: ${reviewId}`);

          // Match GitHub review comments to ReviewIssue records by file+line
          try {
            const ghComments = await ghListReviewComments(
              installationId, owner, repoName, pr.number, reviewId,
            );
            const issueRecords = await prisma.reviewIssue.findMany({
              where: { pullRequestId: pr.id },
              select: { id: true, filePath: true, lineNumber: true },
            });

            for (const issue of issueRecords) {
              if (!issue.filePath) continue;
              const match = ghComments.find(
                (c) => c.path === issue.filePath && c.line === issue.lineNumber,
              );
              if (match) {
                await prisma.reviewIssue.update({
                  where: { id: issue.id },
                  data: { githubCommentId: BigInt(match.id) },
                });
              }
            }
            console.log(`[reviewer] Matched ${issueRecords.filter((i) => i.filePath).length} review issues to GitHub comment IDs`);
          } catch (matchErr) {
            console.error("[reviewer] Failed to match GitHub comment IDs:", matchErr);
          }
        } catch (err) {
          console.error("[reviewer] Failed to submit inline review, falling back to summary-only:", err);
        }
      }

      if (!inlineReviewSucceeded) {
        // All findings go into the summary since none were posted inline
        const findingsBlock = buildLowSeveritySummary(allParsedFindings);
        const summaryBody = buildReviewSummary(findingsBlock);
        try {
          await ghCreatePullRequestReview(
            installationId, owner, repoName, pr.number,
            summaryBody, reviewEvent as "COMMENT" | "REQUEST_CHANGES", [],
          );
          console.log(`[reviewer] PR review submitted without inline comments, ${allParsedFindings.length} in summary (${reviewEvent})`);
        } catch (err) {
          console.error("[reviewer] Failed to submit PR review, falling back to comment:", err);
          await ghCreatePullRequestComment(installationId, owner, repoName, pr.number, summaryBody);
        }
      }
    } else if (isBitbucket) {
      // Bitbucket: post inline comments individually, then a summary comment
      for (const comment of inlineComments) {
        try {
          await bitbucket.createInlineComment(
            org.id, owner, repoName, pr.number,
            comment.path, comment.line, comment.body,
          );
        } catch (err) {
          console.error(`[reviewer] Failed to post Bitbucket inline comment on ${comment.path}:${comment.line}:`, err);
        }
      }
      const bbInlinePaths = new Set(inlineComments.map((c) => `${c.path}:${c.line}`));
      const bbNonInlineFindings = allParsedFindings.filter((f) => {
        for (let l = f.startLine; l <= f.endLine; l++) {
          if (bbInlinePaths.has(`${f.filePath}:${l}`)) return false;
        }
        return true;
      });
      const findingsBlock = buildLowSeveritySummary(bbNonInlineFindings);
      const summaryBody = `${filesChanged} file${filesChanged !== 1 ? "s" : ""} reviewed, ${effectiveFindingsCount} finding${effectiveFindingsCount !== 1 ? "s" : ""}${findingsBlock ? "\n\n" + findingsBlock : ""}`;
      await providerCreateComment(pr.number, summaryBody);
      console.log(`[reviewer] Bitbucket review posted with ${inlineComments.length} inline comments, ${bbNonInlineFindings.length} in summary`);
    }

    // Step 6: Persist parsed findings as ReviewIssue records (ALL findings, not just capped/inline)
    // Clear previous findings first (re-review idempotency)
    await prisma.reviewIssue.deleteMany({
      where: { pullRequestId: pr.id },
    });

    // Persist all parsed findings (pre-filter) for dashboard/scoring
    const allPersistFindings = allParsedFindings;
    if (allPersistFindings.length > 0) {
      const severityMap: Record<string, string> = {
        "🔴": "critical",
        "🟠": "high",
        "🟡": "medium",
        "🔵": "low",
        "💡": "low",
      };

      await prisma.reviewIssue.createMany({
        data: allPersistFindings.map((f) => ({
          title: f.title.replace(/^(CRITICAL|HIGH|MEDIUM|LOW|INFO)\s*—\s*/i, "").trim(),
          description: f.description || f.category,
          severity: severityMap[f.severity] ?? "medium",
          filePath: f.filePath || null,
          lineNumber: f.startLine || null,
          confidence: f.confidence || null,
          pullRequestId: pr.id,
        })),
      });
      console.log(`[reviewer] Saved ${allPersistFindings.length} review issues to DB`);
    }

    // Step 7: Mark as completed + update check run
    await prisma.pullRequest.update({
      where: { id: pr.id },
      data: {
        status: "completed",
        reviewBody: effectiveReviewBody,
      },
    });

    if (checkRunId && isGitHub && installationId) {
      const checkShouldFail =
        threshold !== "none" && (
          hasCritical ||
          (threshold !== "critical" && hasHigh) ||
          (threshold === "medium" && hasMedium)
        );
      const conclusion = checkShouldFail ? "failure" : "success";

      const summaryText = checkShouldFail
        ? hasCritical
          ? "Critical issues found that must be fixed before merge."
          : hasHigh
            ? "High severity issues found that should be fixed before merge."
            : "Medium severity issues found that should be fixed before merge."
        : effectiveFindingsCount > 0
          ? "Review complete. No issues above the configured threshold."
          : "Review complete. No issues found.";

      await ghUpdateCheckRun(
        installationId,
        owner,
        repoName,
        checkRunId,
        conclusion,
        {
          title: `${filesChanged} file${filesChanged !== 1 ? "s" : ""} reviewed, ${effectiveFindingsCount} finding${effectiveFindingsCount !== 1 ? "s" : ""}`,
          summary: summaryText,
        },
      );
      console.log(`[reviewer] Check run updated — conclusion: ${conclusion} (threshold: ${threshold})`);
    }

    // Step 7: Store review in vector DB for timeline/search
    try {
      await ensureReviewCollection();
      const [reviewVector] = await createEmbeddings(
        [effectiveReviewBody.slice(0, 8000)],
        { organizationId: org.id, operation: "embedding", repositoryId: repo.id },
      );
      // Delete previous review point for this PR (re-review case)
      await deleteReviewChunksByPR(pr.id);
      await upsertReviewChunks([
        {
          id: crypto.randomUUID(),
          vector: reviewVector,
          sparseVector: generateSparseVector(effectiveReviewBody),
          payload: {
            orgId: org.id,
            repoId: repo.id,
            pullRequestId: pr.id,
            prNumber: pr.number,
            prTitle: pr.title,
            prUrl: pr.url,
            author: pr.author,
            repoFullName: repo.fullName,
            reviewDate: new Date().toISOString().split("T")[0],
            text: effectiveReviewBody,
          },
        },
      ]);
      console.log(`[reviewer] Review stored in vector DB — prId: ${pr.id}`);
    } catch (err) {
      console.error("[reviewer] Failed to store review in vector DB:", err);
    }

    // Step 8: Store diagrams in vector DB (all mermaid blocks)
    try {
      const mermaidBlocks = extractAllMermaidBlocks(reviewBody);
      if (mermaidBlocks.length > 0) {
        await ensureDiagramCollection();
        await deleteDiagramChunksByPR(pr.id);

        const descriptions = mermaidBlocks.map((block) => {
          const nodeLabels = extractNodeLabels(block.code);
          const typeLabel = DIAGRAM_TYPE_LABELS[block.type];
          return `${typeLabel} for PR #${pr.number}: ${pr.title} in ${repo.fullName} by ${pr.author}. ${nodeLabels.join(", ")}`;
        });

        const vectors = await createEmbeddings(descriptions, {
          organizationId: org.id,
          operation: "embedding",
          repositoryId: repo.id,
        });

        const reviewDate = new Date().toISOString().split("T")[0];
        for (let i = 0; i < mermaidBlocks.length; i++) {
          await upsertDiagramChunk({
            id: crypto.randomUUID(),
            vector: vectors[i],
            sparseVector: generateSparseVector(descriptions[i]),
            payload: {
              orgId: org.id,
              repoId: repo.id,
              pullRequestId: pr.id,
              prNumber: pr.number,
              prTitle: pr.title,
              repoFullName: repo.fullName,
              author: pr.author,
              mermaidCode: mermaidBlocks[i].code,
              diagramType: mermaidBlocks[i].type,
              description: descriptions[i],
              reviewDate,
            },
          });
        }
        console.log(`[reviewer] ${mermaidBlocks.length} diagram(s) stored in vector DB — prId: ${pr.id}`);
      }
    } catch (err) {
      console.error("[reviewer] Failed to store diagrams in vector DB:", err);
    }

    await emitReviewStatus(org.id, {
      ...baseEvent,
      status: "completed",
      step: "completed",
    });

    eventBus.emit({
      type: "review-completed",
      orgId: org.id,
      prNumber: pr.number,
      prTitle: pr.title,
      prUrl: pr.url,
      findingsCount: effectiveFindingsCount,
      filesChanged,
    });

    console.log(`[reviewer] Review completed for PR #${pr.number}`);
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error";
    console.error(`[reviewer] Review failed for PR #${pr.number}:`, err);

    // Update placeholder comment with error if possible
    if (reviewCommentId) {
      await providerUpdateComment(
        reviewCommentId,
        `> 🐙 **Octopus Review** encountered an error while analyzing this pull request.\n>\n> \`${errorMessage}\`\n>\n> Please try again by commenting \`@octopus\` on this PR.`,
      ).catch((e) => console.error("[reviewer] Failed to update placeholder with error:", e));
    }

    // Update check run as failed (GitHub only)
    if (checkRunId && isGitHub && installationId) {
      await ghUpdateCheckRun(
        installationId,
        owner,
        repoName,
        checkRunId,
        "failure",
        {
          title: "Review failed",
          summary: `Octopus Review encountered an error: ${errorMessage}`,
        },
      ).catch((e) => console.error("[reviewer] Failed to update check run:", e));
    }

    // If indexing was in progress, mark it as failed
    if (repo.indexStatus !== "indexed") {
      await prisma.repository.update({
        where: { id: repo.id },
        data: { indexStatus: "failed" },
      }).catch((e) => console.error("[reviewer] Failed to update repo index status:", e));

      pubby.trigger(`presence-org-${org.id}`, "index-status", {
        repoId: repo.id,
        status: "failed",
      }).catch((e) => console.error("[reviewer] Pubby index-status failed trigger failed:", e));
    }

    await prisma.pullRequest
      .update({
        where: { id: pr.id },
        data: {
          status: "failed",
          errorMessage,
        },
      })
      .catch((e) => console.error("[reviewer] Failed to update PR status:", e));

    await emitReviewStatus(org.id, {
      ...baseEvent,
      status: "failed",
      step: "failed",
      error: errorMessage,
    });

    eventBus.emit({
      type: "review-failed",
      orgId: org.id,
      prNumber: pr.number,
      prTitle: pr.title,
      error: errorMessage,
    });
  }
}
