import "server-only";
import { createEmbeddings } from "@/lib/embeddings";
import { ensureFeedbackCollection, searchFeedbackPatterns } from "@/lib/qdrant";
import { safeErrorDetails } from "@/lib/provider-failure";

/** Shared hosted/local policy; the existing strict cosine threshold is unchanged. */
export async function suppressFindingsFromFeedback<T extends { title: string; description: string }>(
  findings: T[],
  scope: { repoId: string; orgId: string },
): Promise<T[]> {
  if (findings.length === 0) return findings;
  try {
    await ensureFeedbackCollection();
    const texts = findings.map((finding) => `${finding.title} ${finding.description}`);
    const vectors = await createEmbeddings(texts, {
      organizationId: scope.orgId,
      operation: "embedding",
      repositoryId: scope.repoId,
    });
    // A partial provider response cannot safely be aligned with the findings.
    if (!Array.isArray(vectors) || vectors.length !== findings.length) return findings;

    const retained: T[] = [];
    for (let i = 0; i < findings.length; i++) {
      const matches = await searchFeedbackPatterns(scope.repoId, vectors[i], scope.orgId);
      if (!matches.some((match) => match.feedback === "down" && match.cosineSimilarity > 0.80)) {
        retained.push(findings[i]);
      }
    }
    if (retained.length < findings.length) {
      console.log(`[feedback-suppression] Suppressed ${findings.length - retained.length} findings via semantic feedback matching`);
    }
    return retained;
  } catch (error) {
    console.warn("[feedback-suppression] Semantic feedback matching failed, continuing:", safeErrorDetails(error));
    return findings;
  }
}
