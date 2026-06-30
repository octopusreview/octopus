/**
 * Parse a PR/MR identifier for `octp review --pr`. Accepts a bare number or a
 * GitHub / Bitbucket / GitLab (incl. self-hosted, nested subgroups) URL.
 * Ported from the standalone CLI; returns a discriminated result instead of
 * throwing, matching apps/cli's style.
 */

export type ParsedPr =
  | { ok: true; prNumber: number; repoFullName?: string }
  | { ok: false; error: string };

export function parsePrArg(arg: string): ParsedPr {
  const trimmed = arg.trim();

  // Bare PR number — require the WHOLE token to be digits so "123abc" or a
  // stray URL fragment doesn't silently parse to a wrong number.
  if (/^\d+$/.test(trimmed)) {
    return { ok: true, prNumber: parseInt(trimmed, 10) };
  }

  const gh = trimmed.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (gh) return { ok: true, prNumber: parseInt(gh[2], 10), repoFullName: gh[1] };

  const bb = trimmed.match(/bitbucket\.org\/([^/]+\/[^/]+)\/pull-requests\/(\d+)/);
  if (bb) return { ok: true, prNumber: parseInt(bb[2], 10), repoFullName: bb[1] };

  // GitLab separates the project path from the resource with "/-/". Anchored
  // to http(s) so only real web URLs match.
  const gl = trimmed.match(/https?:\/\/[^/]+\/(.+?)\/-\/merge_requests\/(\d+)/);
  if (gl) return { ok: true, prNumber: parseInt(gl[2], 10), repoFullName: gl[1] };

  return { ok: false, error: `Invalid PR identifier: "${arg}". Use a PR number or URL.` };
}

/** GitLab calls them merge requests; everyone else pull requests. */
export function prTerms(provider: string): { full: string; short: string } {
  return provider.toLowerCase() === "gitlab"
    ? { full: "merge request", short: "MR" }
    : { full: "pull request", short: "PR" };
}

/** Remap a server message's "pull request"/"PR" wording to GitLab terms. */
export function localizeMessage(message: string, provider: string): string {
  if (provider.toLowerCase() !== "gitlab") return message;
  return message
    .replace(/pull(\s)request/gi, (m, sp) => (m[0] === "P" ? "Merge" : "merge") + sp + "request")
    .replace(/\bPRs\b/g, "MRs")
    .replace(/\bPR\b/g, "MR");
}
