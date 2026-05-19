import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { postJson } from "./api.js";
import { type Credentials } from "./credentials.js";

/**
 * CLI-driven local indexing. Talks to /api/cli/repos/index-local in
 * byte-budgeted batches, then polls until the server flips the repo's
 * indexStatus to "indexed" (or "failed"). Shared by `octp review` when the
 * working-tree repo isn't yet connected to Octopus.
 *
 * Why batches: even a moderate codebase produces a few MB of raw content,
 * which exceeds typical proxy + Next.js body limits in a single POST. Each
 * batch is its own request, processed end-to-end on the server (chunk →
 * embed → upsert) so the CLI can render meaningful per-batch progress.
 */

// Per-batch byte budget — picked low enough to survive Vercel-class
// proxies (4 MB hard cap) and conservative reverse-proxy defaults. JSON
// encoding inflates content ~5–10%, so 3 MB raw → ~3.3 MB on the wire.
const BATCH_TARGET_BYTES = 3 * 1024 * 1024;
const MAX_FILE_BYTES = 100_000;
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_MS = 10 * 60_000;

/**
 * Match the server's `shouldIndex` filter so we don't waste bandwidth
 * uploading files the server will discard. Kept in sync with
 * `apps/web/lib/index-chunking.ts` — if extensions diverge between client
 * and server the user only loses recall on the divergent files, but
 * still worth keeping in sync.
 */
const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".swift", ".kt", ".scala",
  ".vue", ".svelte", ".astro", ".html", ".css", ".scss",
  ".sql", ".graphql", ".proto", ".yaml", ".yml", ".toml",
  ".md", ".mdx", ".txt", ".json", ".xml",
  ".sh", ".bash", ".zsh", ".fish",
  ".dockerfile", ".prisma", ".env.example",
]);

const IGNORE_PATH_FRAGMENTS = [
  "node_modules/", ".git/", "dist/", "build/", ".next/",
  "vendor/", "__pycache__/", ".turbo/", "coverage/",
];
const IGNORE_BASENAMES = new Set([
  "package-lock.json", "bun.lock", "yarn.lock", "pnpm-lock.yaml",
]);

/**
 * Result shapes:
 *   - `ok: true, kind: "indexed"` — CLI uploaded files and the server reported indexed.
 *   - `ok: true, kind: "platform-managed"` — server told us the repo is already managed via the
 *     platform install; caller should re-resolve by-remote and use the existing repoId. Modelled
 *     as `ok: true` because from the caller's perspective the repo IS connected — same review
 *     code path applies; we just skipped the upload.
 *   - `ok: false, reason: "timeout"` — polling hit POLL_MAX_MS without the server settling.
 *     Distinct from `failed` so the CLI can suggest "indexing is still running on the server,
 *     try `octp review` again in a few minutes."
 *   - `ok: false, reason: "failed"` — explicit server-reported failure or upload error.
 */
export type EnsureRepoIndexedResult =
  | { ok: true; kind: "indexed"; repoId: string }
  | { ok: true; kind: "platform-managed" }
  | { ok: false; reason: "timeout" }
  | { ok: false; reason: "failed"; error: string };

export type EnsureRepoIndexedOptions = {
  /** ANSI-colored progress will be drawn to stderr when true. */
  tty: boolean;
};

/**
 * End-to-end index flow: list eligible files, batch them, upload sequentially,
 * poll for completion. Caller has already determined the repo isn't currently
 * known to the server (by-remote 404) and has user consent.
 */
export async function ensureRepoIndexed(
  creds: Credentials,
  remoteUrl: string,
  cwd: string,
  opts: EnsureRepoIndexedOptions,
): Promise<EnsureRepoIndexedResult> {
  const files = collectEligibleFiles(cwd);
  if (files.length === 0) {
    return { ok: false, reason: "failed", error: "No indexable files found in the working tree." };
  }

  const batches = packBatches(files);
  if (batches.length === 0) {
    return { ok: false, reason: "failed", error: "No indexable content after batching." };
  }

  const defaultBranch = detectDefaultBranch(cwd);
  let repoId: string | null = null;

  drawProgress(0, batches.length, "starting", opts.tty);

  for (let i = 0; i < batches.length; i++) {
    const body: Record<string, unknown> =
      i === 0
        ? {
            remoteUrl,
            defaultBranch,
            totalBatches: batches.length,
            totalFiles: files.length,
            batchIndex: 0,
            files: batches[i],
          }
        : {
            repoId,
            totalBatches: batches.length,
            batchIndex: i,
            files: batches[i],
          };

    const res = await postJson<{ repoId: string; done: boolean; chunksInBatch: number }>(
      `${creds.baseUrl}/api/cli/repos/index-local`,
      body,
      creds.token,
      { timeoutMs: 4 * 60_000 },
    );
    if (!res.ok) {
      if (i === 0 && res.status === 409) {
        // Server says this repo is already managed via the platform install.
        // No upload needed — caller will re-resolve via by-remote to get
        // the repoId for the canonical review path.
        drawProgressDone(opts.tty);
        return { ok: true, kind: "platform-managed" };
      }
      drawProgressDone(opts.tty);
      return {
        ok: false,
        reason: "failed",
        error: `batch ${i + 1}/${batches.length}: HTTP ${res.status} — ${res.error}`,
      };
    }
    if (i === 0) repoId = res.data.repoId;
    drawProgress(i + 1, batches.length, "uploading", opts.tty);
  }

  if (!repoId) {
    return { ok: false, reason: "failed", error: "Server did not return a repoId" };
  }

  // After the last batch the server already flipped status to indexed; one
  // final poll covers the case where a tail status update was in flight.
  const final = await pollStatus(creds, repoId, opts);
  drawProgressDone(opts.tty);
  if (final === "timeout") {
    return { ok: false, reason: "timeout" };
  }
  if (final === "failed") {
    return { ok: false, reason: "failed", error: "Server reported indexStatus=failed" };
  }
  return { ok: true, kind: "indexed", repoId };
}

/**
 * Poll the repo status endpoint until the server flips to `indexed` / `failed`,
 * or we hit `POLL_MAX_MS`. Returns a discriminated string so the caller can
 * distinguish "indexing is still running, give up for now" (`timeout`) from
 * "server explicitly said it failed" (`failed`).
 */
async function pollStatus(
  creds: Credentials,
  repoId: string,
  opts: EnsureRepoIndexedOptions,
): Promise<"indexed" | "failed" | "timeout"> {
  const start = Date.now();
  while (Date.now() - start < POLL_MAX_MS) {
    const res = await fetch(
      `${creds.baseUrl}/api/cli/repos/${encodeURIComponent(repoId)}/status`,
      { headers: { authorization: `Bearer ${creds.token}` } },
    );
    if (res.ok) {
      const j = (await res.json()) as { repo: { indexStatus: string; indexedFiles: number; totalFiles: number } };
      if (j.repo.indexStatus === "indexed" || j.repo.indexStatus === "failed") {
        return j.repo.indexStatus as "indexed" | "failed";
      }
      drawProgressIndexing(j.repo.indexedFiles, j.repo.totalFiles, opts.tty);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return "timeout";
}

// ── Walker ──────────────────────────────────────────────────────────────────

function collectEligibleFiles(cwd: string): { path: string; bytes: number }[] {
  // `git ls-files` respects .gitignore for free + lists only tracked files,
  // which gives us a sane default for "what's in this repo." We then apply
  // our own extension/size filter (mirrors the server's `shouldIndex`).
  const result = spawnSync("git", ["ls-files", "-z"], { cwd, encoding: "buffer" });
  if (result.status !== 0) return [];
  const out: { path: string; bytes: number }[] = [];
  const text = result.stdout.toString("utf8");
  for (const path of text.split("\0").filter(Boolean)) {
    if (!isEligible(path)) continue;
    try {
      const full = resolve(cwd, path);
      const st = statSync(full);
      if (st.size > MAX_FILE_BYTES) continue;
      out.push({ path, bytes: st.size });
    } catch {
      // unreadable file — skip
    }
  }
  return out;
}

function isEligible(path: string): boolean {
  if (IGNORE_PATH_FRAGMENTS.some((f) => path.includes(f))) return false;
  const basename = path.split("/").pop() ?? "";
  if (IGNORE_BASENAMES.has(basename)) return false;
  if (basename === "Dockerfile" || basename === "Makefile") return true;
  // Extension match only — never collapse a dotless basename like `LICENSE`
  // to a fake extension. Mirrors the server-side `shouldIndex` filter so
  // CLI doesn't waste bandwidth uploading files the server would skip.
  const dot = basename.lastIndexOf(".");
  if (dot <= 0) return false;
  const ext = basename.slice(dot).toLowerCase();
  return CODE_EXTENSIONS.has(ext);
}

function packBatches(files: { path: string; bytes: number }[]): { path: string; content: string }[][] {
  const batches: { path: string; content: string }[][] = [];
  let current: { path: string; content: string }[] = [];
  let currentBytes = 0;
  for (const f of files) {
    // Avoid over-stuffing — start a new batch if this file would push us
    // past the target. A single file > target still ships in its own
    // batch (size cap on the server-side per-file limit handles that).
    if (currentBytes > 0 && currentBytes + f.bytes > BATCH_TARGET_BYTES) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    try {
      const content = readFileSync(f.path, "utf8");
      // Skip files with NUL bytes — they're binary and will fail the
      // server-side filter anyway; sending them just wastes bandwidth.
      if (content.includes("\0")) continue;
      current.push({ path: f.path, content });
      currentBytes += content.length;
    } catch {
      // unreadable / not utf8 — skip
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

// ── Git helpers ─────────────────────────────────────────────────────────────

function detectDefaultBranch(cwd: string): string {
  // Default branch is what `origin/HEAD` points at. `HEAD` alone is the
  // *currently checked-out* branch which is misleading on any feature
  // branch (we'd record "fix/foo" as the repo's default). Strip the
  // `origin/` prefix when present so we record just the branch name.
  const r = spawnSync(
    "git",
    ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    { cwd, encoding: "utf8" },
  );
  if (r.status === 0 && r.stdout.trim()) {
    const ref = r.stdout.trim();
    return ref.startsWith("origin/") ? ref.slice("origin/".length) : ref;
  }
  return "main";
}

// ── Progress rendering ──────────────────────────────────────────────────────

function drawProgress(done: number, total: number, phase: string, tty: boolean): void {
  if (!tty) {
    if (done === 0 || done === total) {
      process.stderr.write(`  indexing: ${phase} (batch ${done}/${total})\n`);
    }
    return;
  }
  const width = 20;
  const ratio = total === 0 ? 0 : done / total;
  const filled = Math.floor(ratio * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const pct = Math.floor(ratio * 100);
  process.stderr.write(`\r  indexing  [${bar}] ${pct}%  ${phase} (${done}/${total})    `);
}

function drawProgressIndexing(indexed: number, total: number, tty: boolean): void {
  if (!tty || total === 0) return;
  const width = 20;
  const ratio = Math.min(1, indexed / total);
  const filled = Math.floor(ratio * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const pct = Math.floor(ratio * 100);
  process.stderr.write(`\r  embedding [${bar}] ${pct}%  (${indexed}/${total} files)    `);
}

function drawProgressDone(tty: boolean): void {
  if (!tty) return;
  process.stderr.write("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
