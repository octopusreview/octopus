/**
 * `octp repo` — list / status / index / analyze connected repositories.
 *
 * Ported from the standalone @octp/cli (commands/repo/*). The old CLI used
 * commander + ora spinners and threw ApiError; here each subcommand is a plain
 * async branch that returns an exit code and reads the ApiResult discriminated
 * union from the foundation api helpers (never try/catch around them).
 *
 * Progress while polling goes to STDERR so STDOUT stays clean for piping.
 */

import { loadCredentials, type Credentials } from "../lib/credentials.js";
import { getJson, postJson } from "../lib/api.js";
import { resolveRepo } from "../lib/repo-resolver.js";
import { c, success, error, info, heading, table, sanitizeTerminal } from "../lib/output.js";
import { positionals } from "../lib/args.js";
import type { ApiRepo } from "../lib/types.js";

const POLL_INTERVAL_MS = 3000;
const MAX_ATTEMPTS = 200;

const USAGE = `Usage: octp repo <command> [repo]

Commands:
  list                 List all connected repositories (default)
  status [repo]        Show detailed status for a repository
  index [repo]         Index a repository for code search, then wait
  analyze [repo]       Run AI analysis on a repository, then wait

[repo] is a repository name or full name. When omitted, it is auto-detected
from the current git remote.

Options:
  -h, --help           Show this help`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** STDERR progress — keeps STDOUT clean for piping. */
function progress(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

function colorStatus(status: string): string {
  switch (status) {
    case "indexed":
    case "analyzed":
    case "done":
    case "completed":
      return c.green(status);
    case "indexing":
    case "analyzing":
    case "pending":
      return c.yellow(status);
    case "failed":
      return c.red(status);
    case "none":
      return c.dim(status);
    default:
      return c.dim(sanitizeTerminal(status));
  }
}

function formatDate(d: string | null): string {
  if (!d) return "never";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "never";
  return date.toLocaleString();
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

export async function repoCommand(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    info(USAGE);
    return 0;
  }

  const creds = await loadCredentials();
  if (!creds) {
    error("Not signed in. Run `octp login`.");
    return 2;
  }

  const [sub, repoArg] = positionals(argv);

  switch (sub ?? "list") {
    case "list":
      return await listRepos(creds.baseUrl, creds.token);
    case "status":
      return await statusRepo(creds, repoArg);
    case "index":
      return await indexRepo(creds, repoArg);
    case "analyze":
      return await analyzeRepo(creds, repoArg);
    case "chat":
      info("`octp repo chat` moved to `octp chat`");
      return 2;
    default:
      error(`Unknown subcommand: ${sub}`);
      info(USAGE);
      return 2;
  }
}

async function listRepos(baseUrl: string, token: string): Promise<number> {
  const res = await getJson<{ repos: ApiRepo[] }>(`${baseUrl}/api/cli/repos`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    error(`Failed to list repositories (HTTP ${res.status}: ${res.error})`);
    return 1;
  }

  const repos = res.data.repos ?? [];
  if (repos.length === 0) {
    info("No repositories found. Connect repos in the Octopus dashboard.");
    return 0;
  }

  const rows = repos.map((r) => [
    sanitizeTerminal(r.fullName),
    sanitizeTerminal(r.provider),
    colorStatus(r.indexStatus),
    colorStatus(r.analysisStatus),
    String(r._count.pullRequests),
    formatDate(r.indexedAt),
  ]);
  table(rows, ["Repository", "Provider", "Index", "Analysis", "PRs", "Last Indexed"]);
  info(`\n${repos.length} repositories total`);
  return 0;
}

async function statusRepo(creds: Credentials, repoArg?: string): Promise<number> {
  const resolved = await resolveRepo(creds, repoArg);
  if (!resolved.ok) {
    error(resolved.error);
    return 1;
  }

  const res = await getJson<{ repo: ApiRepo }>(
    `${creds.baseUrl}/api/cli/repos/${encodeURIComponent(resolved.repo.id)}/status`,
    { headers: { authorization: `Bearer ${creds.token}` } },
  );
  if (!res.ok) {
    error(`Failed to get repo status (HTTP ${res.status}: ${res.error})`);
    return 1;
  }
  const repo = res.data.repo;

  heading(sanitizeTerminal(repo.fullName));
  info(`  Provider:       ${sanitizeTerminal(repo.provider)}`);
  info(`  Default Branch: ${sanitizeTerminal(repo.defaultBranch)}`);
  info(`  Auto Review:    ${repo.autoReview ? "enabled" : "disabled"}`);

  heading("Indexing");
  info(`  Status:     ${colorStatus(repo.indexStatus)}`);
  info(`  Last Index: ${formatDate(repo.indexedAt)}`);
  info(`  Files:      ${repo.indexedFiles}/${repo.totalFiles}`);
  info(`  Chunks:     ${formatNumber(repo.totalChunks)}`);
  info(`  Vectors:    ${formatNumber(repo.totalVectors ?? 0)}`);
  info(`  Duration:   ${formatDuration(repo.indexDurationMs)}`);

  heading("Analysis");
  info(`  Status:        ${colorStatus(repo.analysisStatus)}`);
  info(`  Last Analyzed: ${formatDate(repo.analyzedAt)}`);
  if (repo.purpose) info(`  Purpose:       ${sanitizeTerminal(repo.purpose)}`);
  if (repo.summary) info(`  Summary:       ${sanitizeTerminal(repo.summary)}`);

  heading("Stats");
  info(`  Pull Requests: ${repo._count.pullRequests}`);
  info(`  Contributors:  ${repo.contributorCount ?? 0}`);
  info("");
  return 0;
}

async function indexRepo(creds: Credentials, repoArg?: string): Promise<number> {
  const resolved = await resolveRepo(creds, repoArg);
  if (!resolved.ok) {
    error(resolved.error);
    return 1;
  }
  const repo = resolved.repo;

  progress(`Starting index for ${repo.fullName}...`);
  const start = await postJson(`${creds.baseUrl}/api/cli/repos/${encodeURIComponent(repo.id)}/index`, {}, creds.token);
  if (!start.ok) {
    error(`Failed to start indexing (HTTP ${start.status}: ${start.error})`);
    return 1;
  }

  progress(`Indexing ${repo.fullName}...`);
  let status = "indexing";
  let attempts = 0;
  while (status === "indexing" && attempts < MAX_ATTEMPTS) {
    attempts++;
    await sleep(POLL_INTERVAL_MS);
    const res = await getJson<{ repo: ApiRepo }>(
      `${creds.baseUrl}/api/cli/repos/${encodeURIComponent(repo.id)}/status`,
      { headers: { authorization: `Bearer ${creds.token}` } },
    );
    if (!res.ok) {
      error(`Failed to poll index status (HTTP ${res.status}: ${res.error})`);
      return 1;
    }
    const updated = res.data.repo;
    status = updated.indexStatus;

    if (status === "indexed") {
      success(`Indexed ${repo.fullName}`);
      info(`Files: ${updated.indexedFiles}/${updated.totalFiles}`);
      info(`Chunks: ${formatNumber(updated.totalChunks)}`);
      info(`Duration: ${formatDuration(updated.indexDurationMs)}`);
      return 0;
    }
    if (status === "failed") {
      error(`Indexing failed for ${repo.fullName}`);
      return 1;
    }
  }

  error(`Indexing timed out for ${repo.fullName} after ${MAX_ATTEMPTS * (POLL_INTERVAL_MS / 1000)}s`);
  return 1;
}

async function analyzeRepo(creds: Credentials, repoArg?: string): Promise<number> {
  const resolved = await resolveRepo(creds, repoArg);
  if (!resolved.ok) {
    error(resolved.error);
    return 1;
  }
  const repo = resolved.repo;

  progress(`Starting analysis for ${repo.fullName}...`);
  const start = await postJson(`${creds.baseUrl}/api/cli/repos/${encodeURIComponent(repo.id)}/analyze`, {}, creds.token);
  if (!start.ok) {
    error(`Failed to start analysis (HTTP ${start.status}: ${start.error})`);
    return 1;
  }

  progress(`Analyzing ${repo.fullName}...`);
  let analysisStatus = "analyzing";
  let attempts = 0;
  while (analysisStatus === "analyzing" && attempts < MAX_ATTEMPTS) {
    attempts++;
    await sleep(POLL_INTERVAL_MS);
    const res = await getJson<{ repo: ApiRepo }>(
      `${creds.baseUrl}/api/cli/repos/${encodeURIComponent(repo.id)}/status`,
      { headers: { authorization: `Bearer ${creds.token}` } },
    );
    if (!res.ok) {
      error(`Failed to poll analysis status (HTTP ${res.status}: ${res.error})`);
      return 1;
    }
    const updated = res.data.repo;
    analysisStatus = updated.analysisStatus;

    if (
      analysisStatus === "analyzed" ||
      analysisStatus === "done" ||
      analysisStatus === "completed"
    ) {
      success(`Analysis complete for ${repo.fullName}`);
      if (updated.purpose) info(`Purpose: ${sanitizeTerminal(updated.purpose)}`);
      if (updated.summary) info(`Summary: ${sanitizeTerminal(updated.summary)}`);
      return 0;
    }
    if (analysisStatus === "failed") {
      error(`Analysis failed for ${repo.fullName}`);
      return 1;
    }
  }

  error(`Analysis timed out for ${repo.fullName} after ${MAX_ATTEMPTS * (POLL_INTERVAL_MS / 1000)}s`);
  return 1;
}
