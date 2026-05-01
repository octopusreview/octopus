import ignore, { type Ignore } from "ignore";

export type { Ignore };

export function parseOctopusIgnore(content: string): Ignore {
  const ig = ignore();
  ig.add(content);
  return ig;
}

/** Filter diff sections, removing files matched by ignore rules */
export function filterDiff(diff: string, ig: Ignore): string {
  const sections = diff.split(/(?=^diff --git )/m);
  return sections
    .filter((section) => {
      const match = section.match(/^diff --git a\/(.+?) b\/(.+)/);
      if (!match) return true;
      return !ig.ignores(match[2]);
    })
    .join("");
}

/** Detect committed build artifacts / dependency folders that should not be in version control */
const MUST_NOT_COMMIT_DIRS = [
  "node_modules",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "__pycache__",
  ".turbo",
  "coverage",
  ".svelte-kit",
  ".output",
  "vendor",
  "bin",
  "obj",
  "target",
];

// Match by exact path segment, not substring. Files like `build.rs` or
// `Cargo.toml` are never flagged on their own because the filename is the
// last segment, not a directory segment. A name-based whitelist is
// intentionally avoided — it would let `node_modules/x/go.sum` slip through.
function isInsideArtifactDir(filePath: string): boolean {
  const segments = filePath.split("/");
  for (let i = 0; i < segments.length - 1; i++) {
    if (MUST_NOT_COMMIT_DIRS.includes(segments[i])) return true;
  }
  return false;
}

export function detectBadCommits(diff: string): string[] {
  const badFiles: string[] = [];
  for (const match of diff.matchAll(/^diff --git a\/(.+?) b\/(.+)/gm)) {
    const filePath = match[2];
    if (isInsideArtifactDir(filePath)) badFiles.push(filePath);
  }
  return badFiles;
}
