import { logAiUsage } from "./ai-usage";
import { createAiMessage } from "./ai-router";

/**
 * Reranker — LLM-as-reranker via Databricks AI Gateway.
 *
 * Originally backed by Cohere's rerank-v3.5 cross-encoder. The workspace
 * doesn't have a Cohere subscription, and none of the Databricks-hosted
 * foundation models are cross-encoder rerankers (they're all chat LLMs),
 * so we fake it: send the query + numbered candidate snippets in a single
 * batched prompt and ask the model to return a JSON array of relevance
 * scores. Sort by score, apply threshold, return.
 *
 * Trade-offs vs. a real cross-encoder:
 *   - One LLM call per rerank (~1–2s end-to-end with Haiku) instead of a
 *     dedicated reranker microservice. Acceptable for the reviewer path,
 *     which already does multiple AI Gateway calls per review.
 *   - Score quality is "good enough" — Haiku ranks chunks by relevance
 *     reasonably well, especially with a sharp scoring rubric in the
 *     prompt. Not as precise as bge-reranker-v2-m3 or Cohere v3.5, but
 *     definitely better than no rerank.
 *   - Token usage: ~30 tokens × N docs in the prompt (truncated snippets)
 *     + ~5 tokens × N in the response. For N=50, ~1.5k in / 250 out.
 *
 * If you want a true cross-encoder later, the cleanest replacement is to
 * push BAAI/bge-reranker-v2-m3 to UC as an MLflow PyFunc model + a
 * Model Serving endpoint, then swap the createAiMessage call below for a
 * `dbxFetch` to that endpoint's `/invocations`.
 */

type RerankOptions = {
  topK?: number;
  /** Minimum 0–1 relevance score to keep a result. */
  scoreThreshold?: number;
  /** Guarantee at least this many results even if all are below threshold. */
  minResults?: number;
  organizationId: string;
  operation: string;
};

type DocumentWithText = { text?: string; [key: string]: unknown };

/** Per-doc snippet cap to keep the prompt under the model's context. */
const SNIPPET_CHAR_CAP = 600;

/**
 * Model used for reranking. Haiku is the cheapest+fastest Anthropic model
 * available on AI Gateway; the `modelForGateway` translation in ai-router
 * will map this to whatever Databricks-hosted Haiku endpoint is configured
 * (currently `databricks-claude-haiku-4-5`). Override via env if needed.
 */
const RERANK_MODEL = process.env.RERANK_MODEL ?? "claude-haiku-4-5";

function buildPrompt(query: string, snippets: string[]): string {
  const numbered = snippets
    .map((s, i) => {
      const trimmed = s.length > SNIPPET_CHAR_CAP ? s.slice(0, SNIPPET_CHAR_CAP) + "…" : s;
      return `<doc index="${i}">\n${trimmed}\n</doc>`;
    })
    .join("\n\n");

  return `You are ranking code/text snippets by how relevant they are to a user query.

Query: ${query}

For each <doc>, rate its relevance to the query from 0 (irrelevant) to 100 (perfectly relevant). Use the full range — most snippets in a random sample should be in the 0–30 range, with a few being 50+. Only return scores ≥80 for genuine high-confidence matches.

Reply with ONLY a JSON array of {"i": <doc index>, "s": <score 0-100>} objects, one per doc, in any order. No prose, no markdown fences, just the JSON array.

${numbered}`;
}

function parseScores(text: string, docCount: number): Map<number, number> {
  // Strip ``` fences if the model added them despite instructions.
  let body = text.trim();
  const fence = body.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fence) body = fence[1].trim();
  // Take the first [...] block in case the model added trailing prose.
  const arrayMatch = body.match(/\[[\s\S]*\]/);
  if (arrayMatch) body = arrayMatch[0];

  const out = new Map<number, number>();
  try {
    const parsed = JSON.parse(body) as Array<{ i?: number; index?: number; s?: number; score?: number }>;
    if (!Array.isArray(parsed)) return out;
    for (const row of parsed) {
      const idx = typeof row.i === "number" ? row.i : row.index;
      const score = typeof row.s === "number" ? row.s : row.score;
      if (typeof idx === "number" && typeof score === "number" && idx >= 0 && idx < docCount) {
        // Clamp to [0, 100] then normalize to [0, 1] for compatibility with
        // the old Cohere score threshold (which was already in 0–1 space).
        out.set(idx, Math.max(0, Math.min(100, score)) / 100);
      }
    }
  } catch {
    // fall through with an empty map; caller will fall back to original order
  }
  return out;
}

export async function rerankDocuments<T extends DocumentWithText>(
  query: string,
  documents: T[],
  options: RerankOptions,
): Promise<T[]> {
  if (documents.length <= 1) return documents;

  const topK = options.topK ?? 10;
  const scoreThreshold = options.scoreThreshold ?? 0.2;
  const minResults = options.minResults ?? 1;

  // Defensive: if the upstream caller passed in tons of docs, cap to a
  // reasonable batch size so we don't blow the prompt budget. The reviewer
  // typically passes 50; chat sometimes passes 20. 80 is a comfortable cap.
  const MAX_BATCH = 80;
  const batch = documents.slice(0, MAX_BATCH);
  const snippets = batch.map((d) => d.text ?? "");

  // Skip silently if every snippet is empty (degenerate input — nothing to
  // rerank; preserve original order, just trim).
  if (snippets.every((s) => !s)) return documents.slice(0, topK);

  try {
    const response = await createAiMessage(
      {
        model: RERANK_MODEL,
        maxTokens: 1024,
        messages: [{ role: "user", content: buildPrompt(query, snippets) }],
      },
      options.organizationId,
    );

    await logAiUsage({
      provider: response.provider,
      model: RERANK_MODEL,
      operation: options.operation,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      cacheReadTokens: response.usage.cacheReadTokens,
      cacheWriteTokens: response.usage.cacheWriteTokens,
      organizationId: options.organizationId,
    });

    const scores = parseScores(response.text, snippets.length);

    if (scores.size === 0) {
      console.warn("[reranker] LLM rerank returned no parseable scores, skipping rerank");
      return documents.slice(0, topK);
    }

    // Build {doc, score} pairs, default score 0 for any docs the LLM didn't
    // include (it's instructed to score all of them; treat omissions as 0).
    const scored = batch.map((doc, i) => ({ doc, score: scores.get(i) ?? 0 }));
    scored.sort((a, b) => b.score - a.score);

    const aboveThreshold = scored.filter((s) => s.score >= scoreThreshold);
    const final =
      aboveThreshold.length >= minResults
        ? aboveThreshold
        : scored.slice(0, Math.max(minResults, aboveThreshold.length));

    return final.slice(0, topK).map((s) => s.doc);
  } catch (err) {
    console.warn("[reranker] LLM rerank failed, skipping rerank:", err instanceof Error ? err.message : err);
    return documents.slice(0, topK);
  }
}
