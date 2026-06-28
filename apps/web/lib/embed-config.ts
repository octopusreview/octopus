/**
 * Process-wide embedding configuration.
 *
 * Octopus's vector store (Qdrant collections, schema in `qdrant.ts`) is
 * created with a fixed dim, so the embedding provider + model + dim need
 * to be consistent across the lifetime of a deployment. We resolve them
 * once at module load time via env so that:
 *
 *   - the Qdrant collection's `VECTOR_SIZE` matches the embeddings the
 *     embedder produces (mismatched dim → 400 from Qdrant on upsert);
 *   - `createEmbeddings` doesn't have to relitigate the choice per call;
 *   - self-hosters running all-local (Ollama LLM + Ollama embeddings)
 *     can opt in with a single env block instead of editing source.
 *
 * Switching providers on an existing deployment requires wiping the
 * Qdrant collections — different models produce vectors that aren't
 * comparable. The dim-mismatch errors thrown in `embeddings.ts` surface
 * that with an actionable message instead of a cryptic Qdrant 400.
 *
 * `OCTOPUS_EMBED_PROVIDER` (default: openai) — "openai" | "ollama".
 * `OCTOPUS_EMBED_MODEL`    — model id passed to the provider. Sensible
 *                            defaults per provider (see `defaultModel`).
 * `OCTOPUS_EMBED_DIM`      — vector dimension. Defaults match the model.
 * `OCTOPUS_OLLAMA_BASE_URL`— Ollama HTTP endpoint for embeddings (default
 *                            `http://localhost:11434`). Kept separate from
 *                            per-org `Organization.ollamaBaseUrl` because
 *                            embedding is a system-level concern that runs
 *                            outside any org context (eg. docs indexing).
 */

export type EmbedProvider = "openai" | "ollama";

export interface EmbedConfig {
  provider: EmbedProvider;
  model: string;
  dim: number;
  /** Only populated when provider === "ollama". */
  ollamaBaseUrl?: string;
}

function defaultModel(provider: EmbedProvider): string {
  return provider === "ollama" ? "nomic-embed-text" : "text-embedding-3-large";
}

function defaultDim(provider: EmbedProvider, model: string): number {
  if (provider === "openai") {
    if (model === "text-embedding-3-small") return 1536;
    if (model === "text-embedding-ada-002") return 1536;
    return 3072; // text-embedding-3-large
  }
  // Ollama
  if (model === "nomic-embed-text") return 768;
  if (model === "mxbai-embed-large") return 1024;
  if (model === "snowflake-arctic-embed2") return 1024;
  return 768;
}

function parseProvider(raw: string | undefined): EmbedProvider {
  const v = raw?.trim().toLowerCase();
  if (v === "ollama") return "ollama";
  return "openai";
}

/**
 * Resolve the active embedding config from process env. Pure — no side
 * effects, no validation against running services (that's the validator's
 * job, called separately at startup). Safe to call on every request.
 */
export function getEmbedConfig(): EmbedConfig {
  const provider = parseProvider(process.env.OCTOPUS_EMBED_PROVIDER);
  const model = process.env.OCTOPUS_EMBED_MODEL?.trim() || defaultModel(provider);
  const dimEnv = process.env.OCTOPUS_EMBED_DIM?.trim();
  const dim = dimEnv && /^\d+$/.test(dimEnv) ? Number(dimEnv) : defaultDim(provider, model);

  const config: EmbedConfig = { provider, model, dim };
  if (provider === "ollama") {
    config.ollamaBaseUrl =
      process.env.OCTOPUS_OLLAMA_BASE_URL?.trim().replace(/\/+$/, "") ||
      "http://localhost:11434";
  }
  return config;
}
