/**
 * Curated list of Ollama models offered in Settings → Models → Local models.
 *
 * Admins pick from this list rather than typing arbitrary tags: it keeps the
 * download UX to a few vetted, code-review-suitable models with honest size /
 * RAM expectations, and bounds what the pull endpoint will fetch (the POST
 * route validates the requested model against these names).
 *
 * `name` is the exact Ollama tag (also the suffix of the `ollama:<name>` model
 * id registered in AvailableModel on a successful pull). `sizeGb` is the
 * approximate download size; `ramHint` is rough guidance for running it.
 */
export interface OllamaCatalogEntry {
  name: string;
  displayName: string;
  category: "llm" | "embedding";
  sizeGb: number;
  ramHint: string;
  blurb: string;
}

export const OLLAMA_CATALOG: OllamaCatalogEntry[] = [
  {
    name: "qwen2.5-coder:7b",
    displayName: "Qwen2.5 Coder 7B",
    category: "llm",
    sizeGb: 4.7,
    ramHint: "8 GB RAM",
    blurb: "Fast code-focused reviews. Good default for a laptop or small VM.",
  },
  {
    name: "qwen2.5-coder:14b",
    displayName: "Qwen2.5 Coder 14B",
    category: "llm",
    sizeGb: 9,
    ramHint: "16 GB RAM",
    blurb: "Stronger reasoning with a balanced quality/speed trade-off.",
  },
  {
    name: "qwen2.5-coder:32b",
    displayName: "Qwen2.5 Coder 32B",
    category: "llm",
    sizeGb: 20,
    ramHint: "32 GB RAM or a GPU",
    blurb: "Highest review quality. Needs a workstation or GPU to be usable.",
  },
  {
    name: "nomic-embed-text",
    displayName: "Nomic Embed Text",
    category: "embedding",
    sizeGb: 0.28,
    ramHint: "2 GB RAM",
    blurb: "768-dimension code/text embeddings for retrieval (OCTOPUS_EMBED_DIM=768).",
  },
];

export function findCatalogEntry(name: string): OllamaCatalogEntry | undefined {
  return OLLAMA_CATALOG.find((e) => e.name === name);
}
