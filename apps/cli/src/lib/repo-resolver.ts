import { spawnSync } from "node:child_process";
import { getJson } from "./api.js";
import type { Credentials } from "./credentials.js";
import type { ApiRepo } from "./types.js";

/**
 * Resolve a repo argument (or the current git remote) to a connected Octopus
 * repository. Returns a discriminated result rather than throwing — matches
 * the rest of apps/cli (ApiResult-style). Ported from the standalone CLI.
 */

/**
 * Extract `owner/repo` (or nested subgroup path) from a git remote URL.
 * Handles SSH (scp-like + URL form), HTTPS, custom ports, and GitLab
 * subgroups: git@github.com:o/r.git · https://h:443/g/sub/r.git ·
 * ssh://git@h:2222/g/sub/r.git
 */
export function parseGitRemote(url: string): string | null {
  const sshUrl = url.match(/^ssh:\/\/[^/]+\/(.+?)(?:\.git)?\/?$/);
  if (sshUrl && sshUrl[1].length > 0) return sshUrl[1];
  const ssh = url.match(/git@[^:]+:(.+?)(?:\.git)?\/?$/);
  if (ssh && ssh[1].length > 0) return ssh[1];
  const https = url.match(/https?:\/\/[^/]+\/(.+?)(?:\.git)?\/?$/);
  if (https && https[1].length > 0) return https[1];
  return null;
}

function git(args: string[]): string | null {
  const r = spawnSync("git", args, { encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout;
}

export function getGitRemoteUrl(): string | null {
  const origin = git(["remote", "get-url", "origin"]);
  if (origin) return origin.trim();
  const remotes = git(["remote"]);
  const first = remotes
    ?.split("\n")
    .map((s) => s.trim())
    .filter(Boolean)[0];
  if (!first) return null;
  return git(["remote", "get-url", first])?.trim() ?? null;
}

export type ResolveResult = { ok: true; repo: ApiRepo } | { ok: false; error: string };

export async function resolveRepo(creds: Credentials, repoArg?: string): Promise<ResolveResult> {
  const res = await getJson<{ repos: ApiRepo[] }>(`${creds.baseUrl}/api/cli/repos`, {
    headers: { authorization: `Bearer ${creds.token}` },
  });
  if (!res.ok) {
    return { ok: false, error: `Could not list repositories (HTTP ${res.status}: ${res.error})` };
  }
  const repos = res.data.repos ?? [];

  if (repoArg) {
    const lower = repoArg.toLowerCase();
    const match = repos.find(
      (r) =>
        r.fullName === repoArg ||
        r.name === repoArg ||
        r.fullName.toLowerCase() === lower ||
        r.name.toLowerCase() === lower,
    );
    if (!match) {
      return { ok: false, error: `Repository "${repoArg}" not found. Run \`octp repo list\` to see available repos.` };
    }
    return { ok: true, repo: match };
  }

  const remoteUrl = getGitRemoteUrl();
  if (!remoteUrl) {
    return { ok: false, error: "Not in a git repository. Provide a repo name or run from a git directory." };
  }
  const fullName = parseGitRemote(remoteUrl);
  if (!fullName) {
    return { ok: false, error: `Could not parse git remote URL: ${remoteUrl}` };
  }
  const match = repos.find((r) => r.fullName.toLowerCase() === fullName.toLowerCase());
  if (!match) {
    return {
      ok: false,
      error: `Repository "${fullName}" is not connected to your Octopus organization. Run \`octp repo list\` to see available repos.`,
    };
  }
  return { ok: true, repo: match };
}
