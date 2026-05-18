import "server-only";
import { prisma } from "@octopus/db";

/**
 * Single source of truth for the self-hosted release-check feature.
 *
 * Both `/api/releases/latest/route.ts` (read path) and the
 * `refresh-release-cache` pg-boss worker import from here. Keeping the
 * cache + GitHub-fetch logic out of the route module avoids pulling
 * Next.js server-runtime into worker context (which would otherwise
 * fail at worker boot), and ensures only one upsert call site exists.
 */

const RELEASES_API = "https://api.github.com/repos/octopusreview/octopus/releases/latest";
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
 * cache — callers decide whether to persist (the worker always does;
 * the route does on cache miss). Returns null on any network/parse failure
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
    const body = (await r.json()) as {
      tag_name?: string;
      html_url?: string;
      published_at?: string;
      body?: string;
    };
    if (!body.tag_name || !body.html_url || !body.published_at) return null;
    return {
      tagName: body.tag_name,
      htmlUrl: body.html_url,
      publishedAt: body.published_at,
      body: body.body ?? "",
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

/**
 * Strict semver comparator: returns -1 if a<b, 0 if equal, 1 if a>b.
 * Throws on invalid input — callers must catch and decide how to surface
 * (`isUpToDate` ends up `false` so the user sees "could not check" rather
 * than a silent wrong answer). Pre-release identifiers are honoured per
 * semver.org §11: 1.0.0-rc < 1.0.0.
 */
export function compareSemver(a: string, b: string): number {
  const ap = parseSemver(a);
  const bp = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    if (ap.main[i] !== bp.main[i]) return ap.main[i] < bp.main[i] ? -1 : 1;
  }
  // Per semver: a version WITHOUT prerelease ranks higher than one WITH.
  if (!ap.pre && bp.pre) return 1;
  if (ap.pre && !bp.pre) return -1;
  if (!ap.pre && !bp.pre) return 0;
  return comparePrerelease(ap.pre!, bp.pre!);
}

function parseSemver(input: string): { main: [number, number, number]; pre: string | null } {
  const trimmed = input.trim().replace(/^v/, "");
  const [main, ...rest] = trimmed.split(/[-+]/);
  const pre = rest.length > 0 && !input.includes("+") ? rest.join("-") : null;
  const parts = main.split(".");
  if (parts.length === 0 || parts.length > 3) {
    throw new Error(`Not a semver string: ${input}`);
  }
  const nums: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    const part = parts[i] ?? "0";
    if (!/^\d+$/.test(part)) throw new Error(`Not a semver string: ${input}`);
    nums[i] = parseInt(part, 10);
  }
  return { main: nums, pre };
}

function comparePrerelease(a: string, b: string): number {
  const ai = a.split(".");
  const bi = b.split(".");
  for (let i = 0; i < Math.max(ai.length, bi.length); i += 1) {
    const ax = ai[i];
    const bx = bi[i];
    if (ax === undefined) return -1;
    if (bx === undefined) return 1;
    const aNum = /^\d+$/.test(ax);
    const bNum = /^\d+$/.test(bx);
    if (aNum && bNum) {
      const an = parseInt(ax, 10);
      const bn = parseInt(bx, 10);
      if (an !== bn) return an < bn ? -1 : 1;
    } else if (aNum !== bNum) {
      return aNum ? -1 : 1; // numeric < alphanumeric
    } else if (ax !== bx) {
      return ax < bx ? -1 : 1;
    }
  }
  return 0;
}
