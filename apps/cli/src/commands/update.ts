import { loadCredentials } from "../lib/credentials.js";
import { getJson } from "../lib/api.js";
import { hasFlag } from "../lib/args.js";
import { error, info, success, c } from "../lib/output.js";

// Must track VERSION in index.tsx. The compiled binary has no package.json to
// read from at runtime, so the current version is hardcoded here.
const CURRENT = "0.1.0";

const RELEASES_URL = "https://api.github.com/repos/octopusreview/octopus/releases";
const TAG_PREFIX = "octp-v";
const DEFAULT_SERVER = "https://octopus-review.ai";

type GithubRelease = { tag_name?: unknown };

/**
 * Compare two semver-ish strings (e.g. "0.2.0" vs "0.1.0"). Returns >0 if a>b,
 * <0 if a<b, 0 if equal. Missing/non-numeric segments are treated as 0.
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = parseInt(pa[i] ?? "0", 10) || 0;
    const nb = parseInt(pb[i] ?? "0", 10) || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function printHelp(): void {
  console.log(`octp update — check for a newer octp CLI release

Usage:
  octp update [--check]

This command only CHECKS GitHub for the latest published CLI release and prints
the upgrade instruction. It does NOT download or replace the binary in-process.

Flags:
  --check       Check for a newer version (default behavior)
  -h, --help    Show this help`);
}

/** `octp update` — check GitHub for a newer octp CLI release and instruct how to upgrade. */
export async function updateCommand(argv: string[]): Promise<number> {
  if (hasFlag(argv, "--help", "-h")) {
    printHelp();
    return 0;
  }

  // creds are optional here — only used to point the install URL at the
  // configured server (self-host friendly). No auth required.
  const creds = await loadCredentials();
  const server = creds?.baseUrl || DEFAULT_SERVER;

  const res = await getJson<GithubRelease[]>(RELEASES_URL);
  if (!res.ok) {
    if (res.status === 403) {
      error("GitHub API rate limit reached. Try again later.");
      return 1;
    }
    if (res.status === 0) {
      error(`Could not reach GitHub: ${res.error}`);
      return 1;
    }
    error(`Could not fetch releases (HTTP ${res.status}: ${res.error})`);
    return 1;
  }

  if (!Array.isArray(res.data)) {
    error("Unexpected response from GitHub releases API.");
    return 1;
  }

  let latest: string | undefined;
  for (const rel of res.data) {
    const tag = rel?.tag_name;
    if (typeof tag !== "string" || !tag.startsWith(TAG_PREFIX)) continue;
    const version = tag.slice(TAG_PREFIX.length);
    if (!latest || compareSemver(version, latest) > 0) latest = version;
  }

  if (!latest) {
    info("No published CLI release found yet.");
    return 0;
  }

  if (compareSemver(latest, CURRENT) > 0) {
    info(`A new version of octp is available: ${c.green(latest)} (you have ${CURRENT})`);
    info("Upgrade with:");
    info(`  ${c.cyan(`curl -fsSL ${server}/install.sh | sh`)}`);
    return 0;
  }

  success(`octp is up to date (${CURRENT}).`);
  return 0;
}
