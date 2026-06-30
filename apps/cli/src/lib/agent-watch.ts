import { readFile, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { getAgentWatchPath, ensureOctopusHome } from "./paths.js";
import { parseGitRemote } from "./repo-resolver.js";

/**
 * Per-account watch-list backing `octp agent serve`'s code-search loop. Maps a
 * local directory to the `owner/repo` its git origin points at, so the daemon
 * can register those repos and serve code-search tasks the cloud routes to
 * them. Stored at profiles/<account>/agent-watch.json.
 */

export type WatchEntry = { path: string; remoteUrl: string; repoFullName: string; addedAt: string };
export type WatchConfig = { entries: WatchEntry[] };

export async function loadWatchConfig(): Promise<WatchConfig> {
  try {
    const raw = await readFile(getAgentWatchPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<WatchConfig>;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.entries)) {
      const entries = parsed.entries.filter(
        (e): e is WatchEntry =>
          !!e &&
          typeof e === "object" &&
          typeof e.path === "string" &&
          typeof e.repoFullName === "string",
      );
      return { entries };
    }
  } catch {
    // missing / unparseable → empty
  }
  return { entries: [] };
}

async function saveWatchConfig(cfg: WatchConfig): Promise<void> {
  await ensureOctopusHome();
  const p = getAgentWatchPath();
  await writeFile(p, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  await chmod(p, 0o600);
}

function gitRemoteUrlForDir(dir: string): string | null {
  const r = spawnSync("git", ["remote", "get-url", "origin"], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout.trim() || null;
}

export type AddResult = { ok: true; entry: WatchEntry } | { ok: false; error: string };

export async function addWatch(pathArg: string): Promise<AddResult> {
  const path = resolve(pathArg);
  if (!existsSync(path)) return { ok: false, error: `Directory does not exist: ${path}` };
  const remoteUrl = gitRemoteUrlForDir(path);
  if (!remoteUrl) return { ok: false, error: `No git remote 'origin' found in ${path}` };
  const repoFullName = parseGitRemote(remoteUrl);
  if (!repoFullName) return { ok: false, error: `Could not parse a repo from remote: ${remoteUrl}` };

  const cfg = await loadWatchConfig();
  const existing = cfg.entries.find((e) => e.path === path);
  if (existing) {
    existing.remoteUrl = remoteUrl;
    existing.repoFullName = repoFullName;
    await saveWatchConfig(cfg);
    return { ok: true, entry: existing };
  }
  const entry: WatchEntry = { path, remoteUrl, repoFullName, addedAt: new Date().toISOString() };
  cfg.entries.push(entry);
  await saveWatchConfig(cfg);
  return { ok: true, entry };
}

/** Remove a watched dir. Returns the resolved path removed, or null if absent. */
export async function removeWatch(pathArg: string): Promise<string | null> {
  const path = resolve(pathArg);
  const cfg = await loadWatchConfig();
  const before = cfg.entries.length;
  cfg.entries = cfg.entries.filter((e) => e.path !== path);
  if (cfg.entries.length === before) return null;
  await saveWatchConfig(cfg);
  return path;
}

/**
 * Live-resolve watched dirs → Map<repoFullName, localPath>, re-parsing each
 * git remote (so a moved/renamed remote is reflected) and skipping dirs that
 * are missing / not a git repo / have an unparseable remote.
 */
export async function resolveWatchedRepos(): Promise<{ repos: Map<string, string>; warnings: string[] }> {
  const cfg = await loadWatchConfig();
  const repos = new Map<string, string>();
  const warnings: string[] = [];
  for (const e of cfg.entries) {
    if (!existsSync(e.path)) {
      warnings.push(`skip ${e.path} (directory missing)`);
      continue;
    }
    const remote = gitRemoteUrlForDir(e.path);
    if (!remote) {
      warnings.push(`skip ${e.path} (no git remote)`);
      continue;
    }
    const fullName = parseGitRemote(remote);
    if (!fullName) {
      warnings.push(`skip ${e.path} (unparseable remote)`);
      continue;
    }
    // Two watched dirs resolving to the SAME owner/repo (e.g. a fork + its
    // upstream, or two clones) would silently collide in this Map; keep the
    // first and surface the collision rather than serving the cloud whichever
    // clone happened to be inserted last.
    const existing = repos.get(fullName);
    if (existing && existing !== e.path) {
      warnings.push(`skip ${e.path} (${fullName} already served from ${existing})`);
      continue;
    }
    repos.set(fullName, e.path);
  }
  return { repos, warnings };
}
