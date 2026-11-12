import { CohereClient } from "cohere-ai";
import { logAiUsage } from "./ai-usage";
import { safeErrorDetails } from "./provider-failure";

let cohereClient: CohereClient | null = null;

function getCohereClient(): CohereClient | null {
  if (!process.env.COHERE_API_KEY) return null;
  if (!cohereClient) {
    cohereClient = new CohereClient({
      token: process.env.COHERE_API_KEY,
    });
  }
  return cohereClient;
}

type RerankOptions = {
  topK?: number;
  scoreThreshold?: number;
  minResults?: number;
  organizationId: string;
  operation: string;
};

type DocumentWithText = { text?: string; [key: string]: unknown };

export async function rerankDocuments<T extends DocumentWithText>(
  query: string,
  documents: T[],
  options: RerankOptions,
): Promise<T[]> {
  if (documents.length <= 1) return documents;

  const client = getCohereClient();
  if (!client) {
    console.warn("[reranker] COHERE_API_KEY not set, skipping rerank");
    return documents.slice(0, options.topK ?? 10);
  }

  const topK = options.topK ?? 10;
  const scoreThreshold = options.scoreThreshold ?? 0.2;
  const minResults = options.minResults ?? 1;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await client.v2.rerank(
      {
        model: "rerank-v3.5",
        query,
        documents: documents.map((d) => d.text ?? ""),
        topN: topK,
      },
      { abortSignal: controller.signal },
    );

    clearTimeout(timeout);

    // Log usage
    await logAiUsage({
      provider: "cohere",
      model: "rerank-v3.5",
      operation: options.operation,
      inputTokens: 1, // 1 search unit
      outputTokens: 0,
      organizationId: options.organizationId,
    });

    const results = response.results;

    // Apply threshold with minResults guarantee
    const aboveThreshold = results.filter(
      (r) => r.relevanceScore >= scoreThreshold,
    );
    const finalResults =
      aboveThreshold.length >= minResults
        ? aboveThreshold
        : results.slice(0, Math.max(minResults, aboveThreshold.length));

    return finalResults.map((r) => documents[r.index]!);
  } catch (err) {
    console.warn("[reranker] Cohere API failed, skipping rerank:", safeErrorDetails(err));
    return documents.slice(0, options.topK ?? 10);
  }
}
