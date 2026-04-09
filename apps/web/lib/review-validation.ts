/**
 * Shared two-pass validation and cross-file context logic used by both
 * reviewer.ts (PR reviews) and review-core.ts (local reviews).
 */

import { searchSimilarChunks } from "@/lib/qdrant";
import { createEmbeddings } from "@/lib/embeddings";
import { logAiUsage } from "@/lib/ai-usage";
import { createAiMessage } from "@/lib/ai-router";
import type { InlineFinding } from "@/lib/review-dedup";
import type { CrossFileQuery, VerificationQuery } from "@/lib/review-helpers";

// ─── Types ──────────────────────────────────────────────────────────────────

export type FileContentFetcher = (filePath: string) => Promise<string>;

// ─── Cross-File Context Gathering ───────────────────────────────────────────

const MAX_CHARS_PER_CHUNK = 3000;

export async function gatherCrossFileContext(
  queries: CrossFileQuery[],
  repoId: string,
  orgId: string,
  fileContentFetcher?: FileContentFetcher,
): Promise<string> {
  if (queries.length === 0) return "";

  const chunks: string[] = [];
  const seen = new Set<string>();

  // Batch embed all queries at once
  const queryTexts = queries.map((q) => q.query);
  let embeddings: number[][];
  try {
    embeddings = await createEmbeddings(queryTexts, {
      organizationId: orgId,
      operation: "cross-file-verification",
    });
  } catch {
    console.warn("[review-validation] Failed to create embeddings for cross-file queries");
    return "";
  }

  // Search Qdrant for each query
  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    const vector = embeddings[i];
    if (!vector || vector.length === 0) continue;

    try {
      const results = await searchSimilarChunks(repoId, vector, 3, query.query);
      for (const r of results) {
        const key = `${r.filePath}:${r.startLine}`;
        if (!seen.has(key)) {
          seen.add(key);
          chunks.push(`// ${r.filePath}:L${r.startLine}-L${r.endLine}\n${r.text.slice(0, MAX_CHARS_PER_CHUNK)}`);
        }
      }
    } catch {
      // Qdrant search failed for this query — try fallback
    }

    // Fallback: fetch file via GitHub/Bitbucket API if Qdrant returned nothing
    if (chunks.length === 0 && query.filePath && fileContentFetcher) {
      try {
        const content = await fileContentFetcher(query.filePath);
        if (content) {
          const key = `file:${query.filePath}`;
          if (!seen.has(key)) {
            seen.add(key);
            chunks.push(`// ${query.filePath}\n${content.slice(0, MAX_CHARS_PER_CHUNK)}`);
          }
        }
      } catch {
        // File fetch failed — skip silently
      }
    }
  }

  return chunks.join("\n\n");
}

// ─── Finding Verification Context ──────────────────────────────────────────

/**
 * For each finding, gather targeted context from Qdrant to verify or disprove
 * the finding's claim. Unlike gatherCrossFileContext (which searches for
 * cross-file references), this searches the finding's OWN file to check
 * claims like "missing import" or "inconsistent pattern".
 *
 * Returns a map of findingIndex → verification context string.
 */
export async function gatherVerificationContext(
  queries: VerificationQuery[],
  repoId: string,
  orgId: string,
  fileContentFetcher?: FileContentFetcher,
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (queries.length === 0) return result;

  // Batch embed all verification queries
  const queryTexts = queries.map((q) => q.query);
  let embeddings: number[][];
  try {
    embeddings = await createEmbeddings(queryTexts, {
      organizationId: orgId,
      operation: "finding-verification",
    });
  } catch {
    console.warn("[review-validation] Failed to create embeddings for verification queries");
    return result;
  }

  // Search Qdrant for each query and group results by finding index
  const findingChunks = new Map<number, string[]>();

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    const vector = embeddings[i];
    if (!vector || vector.length === 0) continue;

    const idx = query.findingIndex;
    if (!findingChunks.has(idx)) findingChunks.set(idx, []);
    const chunks = findingChunks.get(idx)!;

    try {
      const results = await searchSimilarChunks(repoId, vector, 3, query.query);
      for (const r of results) {
        // Prioritize results from the finding's own file
        const isOwnFile = query.filePath && r.filePath.endsWith(query.filePath.replace(/^.*?\//, ""));
        const prefix = isOwnFile ? "[SAME FILE] " : "";
        chunks.push(`${prefix}// ${r.filePath}:L${r.startLine}-L${r.endLine}\n${r.text.slice(0, MAX_CHARS_PER_CHUNK)}`);
      }
    } catch {
      // Qdrant search failed — try fallback
    }

    // Fallback: fetch file directly if we have a filePath and no same-file results
    const hasSameFileResult = chunks.some((c) => c.startsWith("[SAME FILE]"));
    if (!hasSameFileResult && query.filePath && fileContentFetcher) {
      try {
        const content = await fileContentFetcher(query.filePath);
        if (content) {
          // Get the first 2000 chars (imports/header section) which is most useful for verification
          chunks.push(`[SAME FILE] // ${query.filePath}:L1 (file header)\n${content.slice(0, 2000)}`);
        }
      } catch {
        // File fetch failed — skip
      }
    }
  }

  // Build per-finding verification context
  for (const [idx, chunks] of findingChunks) {
    if (chunks.length > 0) {
      const query = queries.find((q) => q.findingIndex === idx);
      const header = query ? `Verification for: ${query.claim}` : "Verification context";
      result.set(idx, `--- ${header} ---\n${chunks.join("\n\n")}`);
    }
  }

  return result;
}

// ─── Two-Pass Validation ────────────────────────────────────────────────────

export const VALIDATION_MODEL = "claude-sonnet-4-6";

export async function validateFindings(
  findings: InlineFinding[],
  diff: string,
  orgId: string,
  confidenceThreshold: number,
  crossFileContext?: string,
  logPrefix = "[review-validation]",
  verificationContext?: Map<number, string>,
): Promise<InlineFinding[]> {
  if (findings.length === 0) return findings;

  // Build findings summary with per-finding verification context inline
  const findingsSummary = findings
    .map((f, i) => {
      let entry = `[${i}] ${f.severity} ${f.title} (confidence: ${f.confidence})\nFile: ${f.filePath}:L${f.startLine}\nDescription: ${f.description}`;
      const verification = verificationContext?.get(i);
      if (verification) {
        entry += `\n\n>> VERIFICATION CONTEXT FOR FINDING [${i}]:\n${verification}`;
      }
      return entry;
    })
    .join("\n\n");

  const crossFileSection = crossFileContext
    ? `\n\n## Referenced Code Context (for cross-file verification)\nThese code snippets are from files referenced by findings. Use them to verify function signatures, types, and APIs:\n\n${crossFileContext}`
    : "";

  const response = await createAiMessage(
    {
      model: VALIDATION_MODEL,
      maxTokens: 2048,
      messages: [
        {
          role: "user",
          content: `You are a senior code reviewer validating findings from an automated review. For each finding, assign a confidence score (0-100) based on whether it is a genuine issue supported by the diff.

FINDINGS:
${findingsSummary}

DIFF:
\`\`\`diff
${diff.slice(0, 12000)}
\`\`\`${crossFileSection}

Scoring guide:
- 90-100: Issue is directly visible in the diff with near-certainty
- 70-89: Issue is clearly supported by the diff and context
- 50-69: Issue is inferred from patterns, likely but not certain
- 20-49: Issue is speculative or weakly supported
- 0-19: False positive — not supported by the diff at all

When a finding claims a function call has wrong parameters, a missing import, or a type mismatch:
- Check the "Referenced Code Context" section if available for the actual definition
- If the context confirms the usage is correct, assign confidence 10-20
- If the context confirms the issue, keep or raise confidence

When a finding flags a "broad" operation (regex, string replacement, deletion) as over-aggressive:
- Check whether the input is already constrained by prior code (capture groups, filters, conditionals)
- If the input is pre-scoped so the broad operation is intentionally exhaustive, assign confidence 10-20

When a finding is based on a general heuristic ("don't replace all X", "avoid broad regex") rather than a concrete traced bug:
- If no specific incorrect behavior is demonstrated, assign confidence 30-50

When the diff includes comments explaining the domain-specific reason for an approach and the finding contradicts that without concrete counter-evidence:
- Assign confidence 10-20

CRITICAL — VERIFICATION CONTEXT:
Some findings include a ">> VERIFICATION CONTEXT" section with actual code from the repository (fetched from the vector database). This is ground truth from the indexed codebase. Use it to verify or disprove the finding's claims:
- If a finding claims "missing import for X" but the verification context shows the import already exists in the same file, assign confidence 0-10 — it is a false positive
- If a finding claims "missing function call" but the verification context shows the function is already called, assign confidence 0-10
- If a finding claims "inconsistent pattern" but the verification context shows the pattern difference is due to different call-site architectures (both achieving the same result), assign confidence 0-10
- Lines marked [SAME FILE] are from the finding's own file — these are the strongest evidence for or against the claim
- If verification context CONFIRMS the issue (e.g., the import truly does not exist), keep or raise confidence

When a finding claims something is "missing" from a new function (missing DB save, missing auth, missing cleanup):
- Check if the function is called from a larger handler visible in the diff — the caller may already do it
- If the diff shows a function being invoked within a handler that performs the "missing" step earlier, assign confidence 10-20

When a finding flags a pattern as problematic (polling, unencrypted storage, streaming approach):
- Check if the SAME pattern already exists elsewhere in the diff or Referenced Code Context
- If an identical pattern is used nearby in the same file or project, assign confidence 10-20 — the new code is following established conventions

When a finding flags code duplication or DRY violations:
- If the two code paths serve different purposes, handle different concerns, or are likely to diverge, assign confidence 10-20
- Only keep duplication findings (confidence 50+) when the code is truly identical, serves the same purpose, and would clearly benefit from abstraction

When a finding flags a literal number as a "magic number" or "not configurable":
- If it is a cosmetic UX value (delays, timing), a one-time operational constant, or a trivial threshold used in a single place, assign confidence 10-20
- Only keep magic number findings when the value appears multiple times or has non-obvious domain significance

When a finding flags storage/column size concerns:
- If the column type is TEXT, JSONB, or similar unbounded type, assign confidence 10-20
- Only keep size findings when there is evidence the column has a restrictive type (VARCHAR with small limit)

For each finding, respond with ONLY a JSON array:
[{"index": 0, "confidence": 92}, {"index": 1, "confidence": 35}, ...]

Output ONLY the JSON array, nothing else.`,
        },
      ],
    },
    orgId,
  );

  await logAiUsage({
    provider: response.provider,
    model: VALIDATION_MODEL,
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
    const scores = JSON.parse(jsonMatch[0]) as { index: number; confidence: number }[];
    const scoreMap = new Map(scores.map((s) => [s.index, s.confidence]));

    const validated = findings
      .map((f, i) => {
        const newConfidence = scoreMap.get(i);
        if (newConfidence !== undefined) {
          return { ...f, confidence: newConfidence };
        }
        return f;
      })
      .filter((f) => f.confidence >= confidenceThreshold);

    console.log(`${logPrefix} Two-pass validation: ${validated.length}/${findings.length} findings kept (threshold: ${confidenceThreshold})`);
    return validated;
  } catch {
    console.warn(`${logPrefix} Failed to parse two-pass validation response, keeping all findings`);
    return findings;
  }
}
