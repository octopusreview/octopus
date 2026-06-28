/**
 * Pure utility for filtering GitHub `/releases` lists. Kept out of
 * `releases.ts` because that module imports `server-only`, which blocks
 * test imports — and this filter is the part most worth testing.
 *
 * The repo can host two release trains: web `v*` and the CLI's `octp-v*`
 * tags. The shipped /releases/latest can return either, so admins would see
 * "0.5.0 → octp-v0.2.0" upgrade panels every time the CLI shipped — this
 * filter keeps the web-update check honest.
 */

export type GitHubReleaseListItem = {
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
};

export type GitHubWebRelease = {
  tag_name: string;
  html_url: string;
  published_at: string;
  body?: string;
};

// Only tags shaped like `v1.2.3` count as web releases. The CLI's `octp-v*`
// tags don't start with a digit after the `v`, so this regex excludes them
// without an explicit denylist.
export const WEB_RELEASE_TAG_RE = /^v\d/;

/**
 * Pick the latest *web* release from a GitHub `/releases` list. Skips
 * drafts, prereleases, and tags that don't match the web-release pattern.
 * Returns null when no eligible release is found.
 *
 * Sort note: GitHub's `/releases` endpoint sorts by `created_at`
 * (descending) — NOT `published_at` as one might assume, and not
 * documented prominently. For two releases tagged on the same commit
 * (or for a backdated `published_at`), the two orderings disagree. We
 * filter first, then re-sort by `published_at` desc explicitly so the
 * "latest" we surface to admins is the most recently *published* one,
 * which is what they actually care about.
 */
export function selectLatestWebRelease(
  list: GitHubReleaseListItem[],
): GitHubWebRelease | null {
  const eligible: GitHubWebRelease[] = [];
  for (const rel of list) {
    if (rel.draft || rel.prerelease) continue;
    if (typeof rel.tag_name !== "string" || !WEB_RELEASE_TAG_RE.test(rel.tag_name)) continue;
    if (typeof rel.html_url !== "string" || typeof rel.published_at !== "string") continue;
    eligible.push({
      tag_name: rel.tag_name,
      html_url: rel.html_url,
      published_at: rel.published_at,
      body: rel.body,
    });
  }
  if (eligible.length === 0) return null;
  // Date.parse on an ISO-8601 string is stable across V8/JSC and tolerant
  // of the "Z" timezone marker GitHub emits. Highest timestamp wins.
  eligible.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  return eligible[0];
}
