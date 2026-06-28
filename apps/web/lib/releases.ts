import "server-only";
import { prisma } from "@octopus/db";
import {
  selectLatestWebRelease,
  type GitHubReleaseListItem,
} from "./releases-select";

export { compareSemver } from "./semver";
export { selectLatestWebRelease } from "./releases-select";

/**
 * Single source of truth for the self-hosted release-check feature.
 *
 * The read paths (`/api/releases/latest/route.ts` and the Updates page)
 * import from here. The route lazily refreshes the cache on a miss/stale
 * read via `getCachedOrFreshRelease`, so the feature works with no
 * background job. (A daily warm-keeper worker could call these same
 * functions later without importing a route module — keeping Next.js
 * server runtime out of worker context.)
 */

// We deliberately do NOT use `/releases/latest` — the repo can host two
// release trains (web `v*` tags + the CLI's `octp-v*` tags), both published
// as normal (non-prerelease) releases. `/releases/latest` returns the most
// recently published one regardless of tag, so a fresh CLI cut would
// otherwise be presented to a self-hoster as a 'new web release available'
// upgrade panel pointing at the wrong tag. Listing + filtering via
// `selectLatestWebRelease` keeps the update check honest. per_page=100 (the
// GitHub max) so a burst of CLI releases can't push the latest web release
// off the first page.
const RELEASES_API = "https://api.github.com/repos/octopusreview/octopus/releases?per_page=100";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export type CachedRelease = {
  tagName: string;
  htmlUrl: string;
  publishedAt: string;
  body: string;
  fetchedAt: string;
};

export async function readReleaseCache(): Promise<CachedRelease | null> {
  const row = await prisma.systemConfig.findUnique({
    where: { id: "singleton" },
    select: { latestRelease: true },
  });
  if (!row?.latestRelease) return null;
  return row.latestRelease as unknown as CachedRelease;
}

export function isReleaseCacheStale(cached: CachedRelease): boolean {
  const ts = new Date(cached.fetchedAt).getTime();
  return Number.isNaN(ts) || Date.now() - ts > CACHE_TTL_MS;
}

export async function writeReleaseCache(value: CachedRelease): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", latestRelease: value as unknown as object },
    update: { latestRelease: value as unknown as object },
  });
}

/**
 * Fetches the latest release from the GitHub API. Does NOT write to the
 * cache — callers decide whether to persist (the get-or-fresh wrapper
 * does on cache miss). Returns null on any network/parse failure
 * so callers can fall back gracefully.
 */
export async function fetchLatestRelease(): Promise<CachedRelease | null> {
  try {
    const r = await fetch(RELEASES_API, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "octopus-self-hosted-update-check",
      },
    });
    if (!r.ok) {
      console.warn(`[releases] GitHub Releases API returned ${r.status}`);
      return null;
    }
    const list = (await r.json()) as GitHubReleaseListItem[];
    if (!Array.isArray(list)) return null;
    const latest = selectLatestWebRelease(list);
    if (!latest) return null;
    return {
      tagName: latest.tag_name,
      htmlUrl: latest.html_url,
      publishedAt: latest.published_at,
      body: latest.body ?? "",
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.warn("[releases] GitHub fetch failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * Get-or-refresh wrapper. Reads cache; on miss or stale, fetches fresh and
 * persists. Used by the route handler so the user gets a useful answer even
 * if the daily worker hasn't run yet.
 */
export async function getCachedOrFreshRelease(): Promise<CachedRelease | null> {
  const cached = await readReleaseCache();
  if (cached && !isReleaseCacheStale(cached)) return cached;
  const fresh = await fetchLatestRelease();
  if (fresh) {
    await writeReleaseCache(fresh);
    return fresh;
  }
  // Fresh fetch failed — return the stale cache rather than nothing.
  return cached;
}

