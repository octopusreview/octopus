import type { Ignore } from "@/lib/octopus-ignore";

/**
 * File-level + chunk-level helpers shared by every indexing entry point
 * (the GitHub-tree path, the clone-based GitLab/Bitbucket path, and the
 * CLI-uploaded local path). Kept in one place so that path filtering and
 * chunk shape stay identical across all three — drift here is a silent
 * way to make some indexing modes produce different retrieval quality.
 */

export const MAX_FILE_SIZE = 100_000; // 100 KB — skip larger files (binaries, dumps)
export const CHUNK_SIZE = 1500; // ~375 tokens
export const CHUNK_OVERLAP = 200;

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".swift", ".kt", ".scala",
  ".vue", ".svelte", ".astro", ".html", ".css", ".scss",
  ".sql", ".graphql", ".proto", ".yaml", ".yml", ".toml",
  ".md", ".mdx", ".txt", ".json", ".xml",
  ".sh", ".bash", ".zsh", ".fish",
  ".dockerfile", ".prisma", ".env.example",
]);

const IGNORE_PATHS = [
  "node_modules/", ".git/", "dist/", "build/", ".next/",
  "vendor/", "__pycache__/", ".turbo/", "coverage/",
  "package-lock.json", "bun.lock", "yarn.lock", "pnpm-lock.yaml",
];

export function shouldIndex(path: string, size?: number, ig?: Ignore): boolean {
  if (size && size > MAX_FILE_SIZE) return false;
  if (IGNORE_PATHS.some((p) => path.includes(p))) return false;
  if (ig?.ignores(path)) return false;

  const ext = "." + path.split(".").pop()?.toLowerCase();
  const basename = path.split("/").pop() ?? "";

  if (basename === "Dockerfile" || basename === "Makefile") return true;

  return CODE_EXTENSIONS.has(ext);
}

export function chunkText(
  content: string,
  filePath: string,
): { text: string; startLine: number; endLine: number }[] {
  const lines = content.split("\n");
  const chunks: { text: string; startLine: number; endLine: number }[] = [];

  let currentChunk = "";
  let startLine = 1;
  let currentLine = 1;

  for (const line of lines) {
    if (line.length > CHUNK_SIZE) {
      if (currentChunk.length > 0) {
        chunks.push({
          text: `// File: ${filePath}\n${currentChunk}`,
          startLine,
          endLine: currentLine - 1,
        });
        currentChunk = "";
      }

      for (let j = 0; j < line.length; j += CHUNK_SIZE - CHUNK_OVERLAP) {
        const piece = line.slice(j, j + CHUNK_SIZE);
        chunks.push({
          text: `// File: ${filePath}\n${piece}`,
          startLine: currentLine,
          endLine: currentLine,
        });
      }

      startLine = currentLine + 1;
    } else if (currentChunk.length + line.length + 1 > CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push({
        text: `// File: ${filePath}\n${currentChunk}`,
        startLine,
        endLine: currentLine - 1,
      });

      const overlapLines = currentChunk.split("\n").slice(-3);
      currentChunk = overlapLines.join("\n") + "\n" + line;
      startLine = currentLine - overlapLines.length;
    } else {
      currentChunk += (currentChunk ? "\n" : "") + line;
    }
    currentLine++;
  }

  if (currentChunk.trim()) {
    chunks.push({
      text: `// File: ${filePath}\n${currentChunk}`,
      startLine,
      endLine: currentLine - 1,
    });
  }

  return chunks;
}
