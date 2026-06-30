import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, readdirSync, existsSync, statSync, lstatSync, realpathSync } from "node:fs";
import { join, resolve, extname, relative, sep, dirname } from "node:path";

// async exec so a multi-second ripgrep doesn't block the daemon's event loop
// (heartbeat + the LLM task loop run in the same process).
const execFileAsync = promisify(execFile);

/**
 * Local code-search handlers for `octp agent serve`'s code-search task loop.
 * Ported from the standalone CLI's searcher, hardened for octp:
 *  - ripgrep is invoked with execFile + an ARG ARRAY (never a shell string),
 *    so a cloud-supplied pattern can't inject shell metacharacters.
 *  - every file read is confined to the repo dir via containedPath(), which is
 *    symlink-aware (realpath): the cloud-supplied `filePaths` / result paths
 *    cannot traverse out via `../../…` NOR via an in-repo symlink to /etc, ~/.ssh,
 *    etc. The pure-Node walker likewise skips symlinks (matching ripgrep's
 *    no-follow default), and every read is size-capped to bound memory.
 *
 * NOTE: this module deliberately does NOT shell out to the `claude` CLI. The
 * Claude-CLI `answer` path (cloud prompt → local agent with tool access) is a
 * separate, opt-in follow-up; runCodeSearch throws for searchType "answer".
 */

export interface SearchResult {
  file: string;
  line: number;
  content: string;
}

export interface SearchResponse {
  results: SearchResult[];
  summary: string;
}

const MAX_SUMMARY_SIZE = 15 * 1024; // 15 KB — mirrors the server's resultSummary cap
// Hard cap on any single cloud-influenced file read. A malicious cloud can name
// which in-repo file gets read (file-read params, or a result path), so without
// this a large checked-in blob would balloon RSS / freeze the daemon. 2 MB is
// far above any real source file.
const MAX_READ_BYTES = 2 * 1024 * 1024;
// Default per-task wall-clock budget when the server omits timeoutMs. Matches
// the server's own AgentSearchTask.timeoutMs default — no point searching past
// when the server gives up on the task.
const DEFAULT_SEARCH_BUDGET_MS = 10_000;

/** Clamp the (server-supplied, untrusted) timeoutMs into an absolute deadline. */
function deadlineFrom(timeoutMs?: number): number {
  const ms =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.min(Math.max(timeoutMs, 1000), 60_000)
      : DEFAULT_SEARCH_BUDGET_MS;
  return Date.now() + ms;
}

const SEARCHABLE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".rb", ".php",
  ".c", ".cpp", ".h", ".cs", ".swift", ".kt",
  ".scala", ".vue", ".svelte",
  ".md", ".json", ".yaml", ".yml", ".toml",
  ".xml", ".html", ".css", ".scss", ".txt",
]);

const SKIP_DIRS = new Set([
  "node_modules", "dist", ".git", ".next", "build",
  "out", "coverage", "__pycache__", ".turbo", "vendor",
]);

/**
 * Resolve `fp` under `repoDir` and confirm it stays inside it. Returns the
 * absolute path when contained, else null. Security boundary: `fp` originates
 * from cloud task params, so both `../../.ssh/id_rsa` (lexical traversal) AND an
 * in-repo symlink that points outside the repo (e.g. `link -> /etc`, then
 * `link/passwd`) must be rejected.
 *
 * resolve() only normalises `.`/`..` lexically — it does NOT dereference
 * symlinks — so the lexical check alone is bypassable by a symlink. We add a
 * realpath check: canonicalise the nearest existing path component and confirm
 * it still lives inside the canonical repo root. A non-existent target carries
 * no symlink risk (nothing to read) and passes the lexical check only.
 */
export function containedPath(repoDir: string, fp: string): string | null {
  const root = resolve(repoDir);
  const target = resolve(root, fp);
  if (target !== root && !target.startsWith(root + sep)) return null; // lexical
  try {
    const realRoot = realpathSync(root);
    let probe = target;
    while (!existsSync(probe)) {
      if (probe === root) return target; // nothing along this path exists yet
      probe = dirname(probe);
    }
    const realProbe = realpathSync(probe);
    if (realProbe !== realRoot && !realProbe.startsWith(realRoot + sep)) return null;
  } catch {
    // realpathSync(root) threw → the repo dir doesn't exist; lexical containment
    // already holds and there's nothing to read, so allow (reads will no-op).
  }
  return target;
}

/** Extract likely search keywords from a natural-language query. */
export function extractKeywords(query: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "shall", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "through", "during",
    "before", "after", "above", "below", "between", "this", "that", "these",
    "those", "i", "you", "he", "she", "it", "we", "they", "what", "which",
    "who", "when", "where", "why", "how", "all", "each", "every", "both",
    "few", "more", "most", "other", "some", "such", "no", "not", "only",
    "same", "so", "than", "too", "very", "just", "but", "and", "or",
    "if", "because", "about", "find", "search", "show", "me", "tell",
    "explain", "code", "function", "file", "used", "using", "called",
    "defined", "nerede", "nasil", "ne", "bu", "bir", "ve", "ile", "icin",
    "mi", "var", "yok",
  ]);
  const words = query
    .replace(/[^\w\s.-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w.toLowerCase()));
  const quoted = query.match(/"([^"]+)"|'([^']+)'/g);
  if (quoted) words.push(...quoted.map((q) => q.replace(/["']/g, "")));
  const identifiers = query.match(/[A-Z][a-z]+[A-Z]\w+|[a-z]+[A-Z]\w+/g);
  if (identifiers) words.unshift(...identifiers); // prioritise code identifiers
  return [...new Set(words)].slice(0, 10);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function hasRipgrep(): Promise<boolean> {
  try {
    await execFileAsync("rg", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/** Run ripgrep via async execFile (no shell) — pattern + dir are discrete args. */
async function ripgrep(pattern: string, dir: string, maxResults = 20): Promise<SearchResult[]> {
  try {
    const args = [
      "--no-heading",
      "--line-number",
      // Never follow symlinks — the security boundary is "read only files
      // physically inside the watched repo". This is ripgrep's DEFAULT, but we
      // pass it explicitly so a user's $RIPGREP_CONFIG_PATH that enables
      // `--follow` can't silently turn the grep path into an out-of-repo read
      // (a CLI flag overrides config-file flags). Mirrors the pure-Node walker,
      // which lstat-skips symlinks for the same reason.
      "--no-follow",
      // Match literally (not as a regex), so behaviour matches the pure-Node
      // fallback (which escapeRegex()es the pattern) and a cloud-supplied
      // keyword with regex metacharacters can't silently fail or mis-match.
      "--fixed-strings",
      "--max-count", "5",
      "--max-columns", "200",
      "--type-add",
      "searchable:*.{ts,tsx,js,jsx,py,go,rs,java,rb,php,c,cpp,h,cs,swift,kt,scala,vue,svelte,md,json,yaml,yml,toml,xml,html,css,scss,txt}",
      "--type", "searchable",
      "--glob", "!node_modules",
      "--glob", "!dist",
      "--glob", "!.git",
      "--glob", "!*.lock",
      "--glob", "!*.min.*",
      "--",
      pattern,
      dir,
    ];
    const { stdout } = await execFileAsync("rg", args, {
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
      timeout: 5000,
    });
    return stdout
      .split("\n")
      .filter(Boolean)
      .slice(0, maxResults)
      .map((line) => {
        const match = line.match(/^(.+?):(\d+):(.*)$/);
        if (!match) return null;
        const filePath = match[1].startsWith(dir) ? match[1].slice(dir.length + 1) : match[1];
        return { file: filePath, line: parseInt(match[2], 10), content: match[3].trim() };
      })
      .filter((r): r is SearchResult => r !== null);
  } catch {
    return [];
  }
}

/** Pure-Node fallback (no ripgrep) — walks the tree, matches lines. */
function nodeSearch(
  pattern: string,
  dir: string,
  maxResults = 20,
  deadline = Date.now() + DEFAULT_SEARCH_BUDGET_MS,
): SearchResult[] {
  const results: SearchResult[] = [];
  const regex = new RegExp(escapeRegex(pattern), "i");

  function walk(currentDir: string): void {
    if (results.length >= maxResults || Date.now() > deadline) return;
    let entries: string[];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxResults || Date.now() > deadline) return;
      if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
      const fullPath = join(currentDir, entry);
      let st;
      try {
        // lstat (not stat) so a symlink reports as a symlink rather than its
        // target — we then skip it, matching ripgrep's no-follow default. This
        // stops an in-repo dir symlink (link -> /etc) from being walked out of
        // the repo and its files read back to the cloud.
        st = lstatSync(fullPath);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        walk(fullPath);
      } else if (st.isFile() && SEARCHABLE_EXTENSIONS.has(extname(entry))) {
        if (st.size > 200_000) continue;
        try {
          const lines = readFileSync(fullPath, "utf-8").split("\n");
          let matchCount = 0;
          for (let i = 0; i < lines.length; i++) {
            if (matchCount >= 5) break;
            if (regex.test(lines[i])) {
              results.push({ file: relative(dir, fullPath), line: i + 1, content: lines[i].trim().slice(0, 200) });
              matchCount++;
              if (results.length >= maxResults) return;
            }
          }
        } catch {
          // skip unreadable
        }
      }
    }
  }
  walk(dir);
  return results;
}

/** Read a contained file with line-number prefixes; null if outside repo / unreadable / too large. */
function readContained(filePath: string, repoDir: string): string | null {
  const full = containedPath(repoDir, filePath);
  if (!full || !existsSync(full)) return null;
  try {
    if (statSync(full).size > MAX_READ_BYTES) return null;
    return readFileSync(full, "utf-8")
      .split("\n")
      .map((line, i) => `${i + 1}: ${line}`)
      .join("\n");
  } catch {
    return null;
  }
}

export async function semanticSearch(
  query: string,
  repoDir: string,
  deadline = Date.now() + DEFAULT_SEARCH_BUDGET_MS,
): Promise<SearchResponse> {
  const keywords = extractKeywords(query);
  const useRg = await hasRipgrep();
  const search = (p: string, d: string, m: number): Promise<SearchResult[]> =>
    useRg ? ripgrep(p, d, m) : Promise.resolve(nodeSearch(p, d, m, deadline));
  const allResults: SearchResult[] = [];
  const seen = new Set<string>();
  for (const keyword of keywords) {
    if (Date.now() > deadline) break;
    for (const r of await search(keyword, repoDir, 15)) {
      const key = `${r.file}:${r.line}`;
      if (!seen.has(key)) {
        seen.add(key);
        allResults.push(r);
      }
    }
  }
  const fileScores = new Map<string, number>();
  for (const r of allResults) fileScores.set(r.file, (fileScores.get(r.file) ?? 0) + 1);
  allResults.sort((a, b) => {
    const d = (fileScores.get(b.file) ?? 0) - (fileScores.get(a.file) ?? 0);
    return d !== 0 ? d : a.line - b.line;
  });
  const top = allResults.slice(0, 30);
  return { results: top, summary: buildSummary(top, keywords, repoDir) };
}

export async function grepSearch(
  pattern: string,
  repoDir: string,
  deadline = Date.now() + DEFAULT_SEARCH_BUDGET_MS,
): Promise<SearchResponse> {
  const useRg = await hasRipgrep();
  const results = useRg ? await ripgrep(pattern, repoDir, 30) : nodeSearch(pattern, repoDir, 30, deadline);
  return { results, summary: buildSummary(results, [pattern], repoDir) };
}

export async function fileReadSearch(filePaths: string[], repoDir: string): Promise<SearchResponse> {
  const results: SearchResult[] = [];
  const parts: string[] = [];
  for (const fp of filePaths.slice(0, 5)) {
    const content = readContained(fp, repoDir);
    if (content) {
      parts.push(`### ${fp}\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``);
      results.push({ file: fp, line: 1, content: `[file content: ${content.split("\n").length} lines]` });
    }
  }
  return { results, summary: parts.join("\n\n").slice(0, MAX_SUMMARY_SIZE) };
}

function buildSummary(results: SearchResult[], keywords: string[], repoDir: string): string {
  if (results.length === 0) return `No results found for: ${keywords.join(", ")}`;
  const byFile = new Map<string, SearchResult[]>();
  for (const r of results) {
    const existing = byFile.get(r.file) ?? [];
    existing.push(r);
    byFile.set(r.file, existing);
  }
  const parts: string[] = [`Search results for: ${keywords.join(", ")}\n`];
  for (const [file, fileResults] of byFile) {
    parts.push(`### ${file}`);
    let fileLines: string[] | null = null;
    const full = containedPath(repoDir, file);
    try {
      if (full && existsSync(full) && statSync(full).size <= MAX_READ_BYTES) {
        fileLines = readFileSync(full, "utf-8").split("\n");
      }
    } catch {
      // ignore
    }
    for (const r of fileResults.slice(0, 5)) {
      if (fileLines) {
        const start = Math.max(0, r.line - 3);
        const end = Math.min(fileLines.length, r.line + 2);
        const ctx = fileLines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join("\n");
        parts.push(`\`\`\`\n${ctx}\n\`\`\``);
      } else {
        parts.push(`L${r.line}: ${r.content}`);
      }
    }
    parts.push("");
  }
  const summary = parts.join("\n");
  return summary.length > MAX_SUMMARY_SIZE ? summary.slice(0, MAX_SUMMARY_SIZE) : summary;
}

/** Dispatch a search task by its searchType. Throws for "answer" (claude-only,
 *  not supported in this build). "claude" falls back to semantic search. */
export async function runCodeSearch(
  searchType: string,
  query: string,
  params: Record<string, unknown>,
  repoDir: string,
  timeoutMs?: number,
): Promise<SearchResponse> {
  // Bound the whole task by the server-declared timeout (clamped) so a malicious
  // or pathological query can't pin the search loop / starve the heartbeat.
  const deadline = deadlineFrom(timeoutMs);
  switch (searchType) {
    case "grep": {
      const pattern = typeof params.pattern === "string" ? params.pattern : query;
      return grepSearch(pattern, repoDir, deadline);
    }
    case "file-read": {
      const filePaths = Array.isArray(params.filePaths)
        ? params.filePaths.filter((p): p is string => typeof p === "string")
        : [];
      return fileReadSearch(filePaths, repoDir);
    }
    case "answer":
      // Claude-CLI answer mode is a separate opt-in build; this daemon never
      // advertises claude-cli, so it should never be routed an answer task.
      throw new Error("answer tasks require the Claude CLI (not enabled in this agent)");
    case "claude":
      // We don't advertise claude-cli, so the server picks "semantic" for us;
      // if a "claude" task arrives anyway, degrade to semantic rather than fail.
      return semanticSearch(query, repoDir, deadline);
    case "semantic":
    default:
      return semanticSearch(query, repoDir, deadline);
  }
}
