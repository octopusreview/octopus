export class EmbeddingDimensionError extends Error {
  constructor(readonly actual: number, readonly configured: number) {
    super("Embedding dimensions do not match OCTOPUS_EMBED_DIM. Check the embedding model and configured dimension.");
  }
}

export class MissingEmbeddingKeyError extends Error {}

export function embeddingConfigAdvice(error: unknown): string | undefined {
  if (error instanceof MissingEmbeddingKeyError) return "Set OPENAI_API_KEY to configure OpenAI embeddings.";
  if (error instanceof EmbeddingDimensionError) {
    const valid = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000;
    return valid(error.actual) && valid(error.configured)
      ? `Embedding returned ${error.actual} dimensions; OCTOPUS_EMBED_DIM is ${error.configured}. Check the embedding model and configured dimension.`
      : "Embedding dimensions do not match OCTOPUS_EMBED_DIM. Check the embedding model and configured dimension.";
  }
}
