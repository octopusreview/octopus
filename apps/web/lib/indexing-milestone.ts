const milestones = ["not_recorded", "authenticating", "authenticated", "cloned", "scanning_files", "fetching_files", "preparing_vectors", "vector_ready", "embedding", "embedded", "writing_vectors", "vectors_written"] as const;
export type IndexingMilestone = typeof milestones[number];

export function isIndexingMilestone(value: unknown): value is IndexingMilestone {
  return typeof value === "string" && milestones.includes(value as IndexingMilestone);
}

/** Record only known log milestones; the last message does not prove the active operation. */
export function indexingMilestone(message: string): IndexingMilestone | undefined {
  switch (message) {
    case "Authenticating with GitHub...": return "authenticating";
    case "GitHub authentication successful": return "authenticated";
    case "Repository cloned successfully": return "cloned";
    case "Scanning repository files...": return "scanning_files";
    case "Processing file contents...":
    case "Fetching and chunking file contents...": return "fetching_files";
    case "Preparing vector database...": return "preparing_vectors";
    case "Vector database ready": return "vector_ready";
  }
  if (/^Processing files\.\.\. \d{1,12}\/\d{1,12}$/.test(message)) return "fetching_files";
  if (/^(?:Generating embeddings for \d{1,12} chunks \(\d{1,12} batch(?:es)?\)|Processing embedding batch \d{1,12}\/\d{1,12})\.\.\.$/.test(message)) return "embedding";
  if (/^Generated \d{1,12} embeddings$/.test(message)) return "embedded";
  if (/^Storing \d{1,12} vectors in database \(\d{1,12} batch(?:es)?\)\.\.\.$/.test(message)) return "writing_vectors";
  if (/^Successfully stored \d{1,12} vectors$/.test(message)) return "vectors_written";
}
