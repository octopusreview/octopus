import type { DependencyChange, TyposquatSignal, RegistrySignal, ProgressCallback } from "./types";
import { levenshtein } from "./utils/levenshtein";
import popularPackages from "./data/popular-packages.json";

const popularMap = popularPackages as Record<string, number>;
const popularNames = Object.keys(popularMap);

const NPM_REGISTRY = "https://registry.npmjs.org";

/**
 * Detect typosquatting by comparing newly added packages against
 * the popular-packages database using Levenshtein distance and
 * pattern-based heuristics.
 *
 * Also checks npm registry for base package existence when suffix/prefix
 * patterns are detected (catches cases where base isn't in popular list).
 */
export async function checkTyposquat(
  deps: DependencyChange[],
  registryData: RegistrySignal[],
  analysisId: string,
  onProgress?: ProgressCallback,
): Promise<TyposquatSignal[]> {
  const added = deps.filter((d) => d.changeType === "added");
  if (added.length === 0) return [];

  // Build a set of packages that don't exist on npm (404)
  const notOnNpm = new Set(
    registryData.filter((r) => !r.exists).map((r) => r.package),
  );

  onProgress?.({
    type: "dep-analysis-progress",
    analysisId,
    step: "typosquat-check",
    message: `Running typosquat detection on ${added.length} new packages...`,
  });

  const results: TyposquatSignal[] = [];
  const seen = new Set<string>();

  for (const dep of added) {
    if (seen.has(dep.name)) continue;
    seen.add(dep.name);

    // Skip if it's already a popular package
    if (dep.name in popularMap) continue;

    const signal = await checkSinglePackage(dep.name, notOnNpm.has(dep.name));
    results.push(signal);

    if (signal.riskScore > 0) {
      console.log(
        `[package-analyzer:typosquat] ${dep.name} → ${signal.signals.join("; ")}`,
      );
      onProgress?.({
        type: "dep-analysis-progress",
        analysisId,
        step: "typosquat-check",
        package: dep.name,
        message: `${dep.name}: ${signal.signals.join("; ")}`,
      });
    }
  }

  return results;
}

async function checkSinglePackage(name: string, isNotOnNpm: boolean): Promise<TyposquatSignal> {
  const signal: TyposquatSignal = {
    package: name,
    similarTo: [],
    signals: [],
    riskScore: 0,
  };

  // ── 1) Levenshtein distance check against popular packages ──
  for (const popular of popularNames) {
    // Skip if lengths differ too much (optimization)
    if (Math.abs(name.length - popular.length) > 2) continue;

    const dist = levenshtein(name, popular);
    if (dist <= 2 && dist > 0) {
      signal.similarTo.push({
        name: popular,
        distance: dist,
        weeklyDownloads: popularMap[popular],
      });

      if (dist <= 1) {
        signal.signals.push(
          `Very similar to "${popular}" (distance: ${dist}, ${formatDownloads(popularMap[popular])} downloads/week)`,
        );
        signal.riskScore = Math.max(signal.riskScore, 30);
      } else {
        signal.signals.push(
          `Similar to "${popular}" (distance: ${dist}, ${formatDownloads(popularMap[popular])} downloads/week)`,
        );
        signal.riskScore = Math.max(signal.riskScore, 20);
      }
    }
  }

  // ── 2) Prefix/suffix pattern ──
  // First check against popular list, then fall back to npm registry lookup
  const SUFFIXES = ["-pro", "-utils", "-js", "-node", "-lib", "-core", "-plus", "-new", "-latest", "-2", "-next", "-modern", "-fast", "-secure"];
  const PREFIXES = ["node-", "js-", "npm-", "get-"];

  for (const suffix of SUFFIXES) {
    if (!name.endsWith(suffix)) continue;
    const base = name.slice(0, -suffix.length);
    if (!base) continue;

    if (base in popularMap) {
      // Base is a well-known popular package
      signal.similarTo.push({
        name: base,
        distance: suffix.length,
        weeklyDownloads: popularMap[base],
      });
      signal.signals.push(
        `Popular package "${base}" (${formatDownloads(popularMap[base])} downloads/week) with suspicious suffix "${suffix}"`,
      );
      signal.riskScore = Math.max(signal.riskScore, 30);
    } else {
      // Base is NOT in popular list — check if it exists on npm
      const baseExists = await checkNpmExists(base);
      if (baseExists) {
        signal.similarTo.push({
          name: base,
          distance: suffix.length,
          weeklyDownloads: baseExists.downloads,
        });
        signal.signals.push(
          `Existing package "${base}" (${formatDownloads(baseExists.downloads)} downloads/week) with suspicious suffix "${suffix}"`,
        );
        // Higher score if this package itself doesn't exist on npm
        signal.riskScore = Math.max(signal.riskScore, isNotOnNpm ? 35 : 25);
      }
    }
  }

  for (const prefix of PREFIXES) {
    if (!name.startsWith(prefix)) continue;
    const base = name.slice(prefix.length);
    if (!base) continue;

    if (base in popularMap) {
      signal.similarTo.push({
        name: base,
        distance: prefix.length,
        weeklyDownloads: popularMap[base],
      });
      signal.signals.push(
        `Popular package "${base}" with suspicious prefix "${prefix}"`,
      );
      signal.riskScore = Math.max(signal.riskScore, 25);
    } else {
      const baseExists = await checkNpmExists(base);
      if (baseExists) {
        signal.similarTo.push({
          name: base,
          distance: prefix.length,
          weeklyDownloads: baseExists.downloads,
        });
        signal.signals.push(
          `Existing package "${base}" (${formatDownloads(baseExists.downloads)} downloads/week) with suspicious prefix "${prefix}"`,
        );
        signal.riskScore = Math.max(signal.riskScore, isNotOnNpm ? 35 : 25);
      }
    }
  }

  // ── 3) Scope confusion (@scope/pkg vs unscoped pkg) ──
  for (const popular of popularNames) {
    if (!popular.startsWith("@")) continue;
    const parts = popular.split("/");
    if (parts.length !== 2) continue;

    const scopeName = parts[0].slice(1);
    const pkgName = parts[1];
    const unscopedVariant = `${scopeName}-${pkgName}`;

    if (name === unscopedVariant) {
      signal.similarTo.push({
        name: popular,
        distance: 0,
        weeklyDownloads: popularMap[popular],
      });
      signal.signals.push(
        `Possible scope confusion: unscoped "${name}" vs scoped "${popular}"`,
      );
      signal.riskScore = Math.max(signal.riskScore, 15);
    }
  }

  // ── 4) Separator tricks (lodash.merge vs lodash-merge vs lodash_merge) ──
  const normalized = name.replace(/[-_.]/g, "");
  for (const popular of popularNames) {
    if (popular === name) continue;
    const popularNorm = popular.replace(/[-_.]/g, "");
    if (normalized === popularNorm && name !== popular) {
      signal.similarTo.push({
        name: popular,
        distance: 0,
        weeklyDownloads: popularMap[popular],
      });
      signal.signals.push(
        `Separator trick: "${name}" normalizes to same as "${popular}"`,
      );
      signal.riskScore = Math.max(signal.riskScore, 20);
    }
  }

  return signal;
}

/** Quick check if a package name exists on npm and get its download count */
async function checkNpmExists(name: string): Promise<{ downloads: number } | null> {
  try {
    const resp = await fetch(`${NPM_REGISTRY}/${encodeURIComponent(name)}`, {
      method: "HEAD",
    });
    if (!resp.ok) return null;

    // Also fetch download count
    try {
      const dlResp = await fetch(
        `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`,
      );
      if (dlResp.ok) {
        const data = await dlResp.json() as Record<string, any>;
        return { downloads: data.downloads ?? 0 };
      }
    } catch {
      // Package exists but can't get downloads
    }
    return { downloads: 0 };
  } catch {
    return null;
  }
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
