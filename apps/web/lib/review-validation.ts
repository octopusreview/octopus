/**
 * Shared two-pass validation and cross-file context logic used by both
 * reviewer.ts (PR reviews) and review-core.ts (local reviews).
 */

import { searchSimilarChunks } from "@/lib/qdrant";
import { createEmbeddings } from "@/lib/embeddings";
import { logAiUsage } from "@/lib/ai-usage";
import { createAiMessage } from "@/lib/ai-router";
import type { InlineFinding } from "@/lib/review-dedup";
import type { CrossFileQuery } from "@/lib/review-helpers";

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

// ─── Two-Pass Validation ────────────────────────────────────────────────────

export const VALIDATION_MODEL = "claude-haiku-4-5-20251001";

export async function validateFindings(
  findings: InlineFinding[],
  diff: string,
  orgId: string,
  confidenceThreshold: number,
  crossFileContext?: string,
  logPrefix = "[review-validation]",
): Promise<InlineFinding[]> {
  if (findings.length === 0) return findings;

  const findingsSummary = findings
    .map((f, i) => `[${i}] ${f.severity} ${f.title} (confidence: ${f.confidence})\nFile: ${f.filePath}:L${f.startLine}\nDescription: ${f.description}`)
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
