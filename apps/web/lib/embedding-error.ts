const dimensionAdvice = (actual: unknown, configured: unknown) => {
  const valid = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000;
  return valid(actual) && valid(configured)
    ? `Embedding returned ${actual} dimensions; OCTOPUS_EMBED_DIM is ${configured}. Check the embedding model and configured dimension.`
    : "Embedding dimensions do not match OCTOPUS_EMBED_DIM. Check the embedding model and configured dimension.";
};
const keyAdvice = "Set OPENAI_API_KEY to configure OpenAI embeddings.";
const ollamaAdvice = "Check that the configured embedding model is pulled on the Ollama server.";
const urlAdvice = "Configured Ollama embedding URL was rejected; check the URL and deployment network policy. For a self-hosted deployment, check the SELF_HOSTED setting.";

export class EmbeddingDimensionError extends Error {
  constructor(readonly actual: number, readonly configured: number) {
    super(dimensionAdvice(actual, configured));
  }
}

export class MissingEmbeddingKeyError extends Error {
  constructor() { super(keyAdvice); this.name = "MissingEmbeddingKeyError"; }
}

export class OllamaEmbeddingResponseError extends Error {
  constructor() { super(ollamaAdvice); this.name = "OllamaEmbeddingResponseError"; }
}

export class OllamaEmbeddingUrlError extends Error {
  constructor() { super(urlAdvice); this.name = "OllamaEmbeddingUrlError"; }
}

export function embeddingConfigAdvice(error: unknown): string | undefined {
  if (error instanceof MissingEmbeddingKeyError) return keyAdvice;
  if (error instanceof OllamaEmbeddingResponseError) return ollamaAdvice;
  if (error instanceof OllamaEmbeddingUrlError) return urlAdvice;
  if (error instanceof EmbeddingDimensionError) {
    return dimensionAdvice(error.actual, error.configured);
  }
}
