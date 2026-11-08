export class EmbeddingDimensionError extends Error {
  constructor() {
    super("Embedding dimensions do not match OCTOPUS_EMBED_DIM. Check the embedding model and configured dimension.");
  }
}
