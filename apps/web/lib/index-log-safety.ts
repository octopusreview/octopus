const safeMessages = new Set([
  "Repository cloned successfully", "Scanning repository files...", "Processing file contents...",
  "Authenticating with GitHub...", "GitHub authentication successful", "Authenticating with GitLab...",
  "GitLab authentication successful", "Authenticating with Bitbucket...", "Bitbucket authentication successful",
  "Fetching and chunking file contents...", "No indexable content found", "Preparing vector database...",
  "Vector database ready", "Could not fetch contributor count", "Found .octopusignore — applying custom ignore rules",
  "Local indexing started", "Local indexing batch complete", "Local indexing complete", "Indexing failed",
]);
const safeProgress = /^(?:Processed \d{1,12} files, skipped \d{1,12}(?:, created \d{1,12} chunks)?|Processing files\.\.\. \d{1,12}\/\d{1,12}|Processing local batch \d{1,12}\/\d{1,12}|Processing embedding batch \d{1,12}\/\d{1,12}\.\.\.|Found \d{1,12} total files, \d{1,12} eligible for indexing|Found \d{1,12} contributors|Generating embeddings for \d{1,12} chunks \(\d{1,12} batch(?:es)?\)\.\.\.|Generated \d{1,12} embeddings|Storing \d{1,12} vectors in database \(\d{1,12} batch(?:es)?\)\.\.\.|Successfully stored \d{1,12} vectors|Indexing complete: \d{1,12} files, \d{1,12} vectors)(?![\s\S])/;

export function safeIndexLogMessage(message: unknown): string | null {
  return typeof message === "string" && (safeMessages.has(message) || safeProgress.test(message)) ? message : null;
}
