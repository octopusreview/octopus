import type { DependencyChange, RegistrySignal, ProgressCallback } from "./types";

const NPM_REGISTRY = "https://registry.npmjs.org";
const NPM_DOWNLOADS = "https://api.npmjs.org/downloads/point/last-week";
const MAX_CONCURRENT = 5;
const MAX_RETRIES = 3;

/**
 * Check npm registry metadata for each dependency.
 * Runs with bounded concurrency and exponential backoff on 429s.
 */
export async function checkRegistry(
  deps: DependencyChange[],
  analysisId: string,
  onProgress?: ProgressCallback,
): Promise<RegistrySignal[]> {
  // Only check added or updated deps
  const toCheck = deps.filter((d) => d.changeType !== "removed");
  if (toCheck.length === 0) return [];

  const results: RegistrySignal[] = [];
  const seen = new Set<string>();

  // Deduplicate packages across multiple package.json files
  const unique = toCheck.filter((d) => {
    if (seen.has(d.name)) return false;
    seen.add(d.name);
    return true;
  });

  // Process in batches of MAX_CONCURRENT
  for (let i = 0; i < unique.length; i += MAX_CONCURRENT) {
    const batch = unique.slice(i, i + MAX_CONCURRENT);
    const batchResults = await Promise.all(
      batch.map((dep, idx) => {
        onProgress?.({
          type: "dep-analysis-progress",
          analysisId,
          step: "registry-check",
          package: dep.name,
          message: `Checking ${dep.name} on npm registry...`,
          progress: { current: i + idx + 1, total: unique.length },
        });
        return checkSinglePackage(dep.name);
      }),
    );
    results.push(...batchResults);
  }

  // Log findings
  for (const r of results) {
    if (r.riskScore > 0) {
      const signals = r.signals.join(", ");
      console.log(`[package-analyzer:registry] ${r.package}: score=${r.riskScore} — ${signals}`);
      onProgress?.({
        type: "dep-analysis-progress",
        analysisId,
        step: "registry-check",
        package: r.package,
        message: `${r.package}: ${signals}`,
      });
    } else {
      console.log(`[package-analyzer:registry] ${r.package}: OK (${r.weeklyDownloads.toLocaleString()} downloads/week)`);
    }
  }

  return results;
}

async function checkSinglePackage(name: string): Promise<RegistrySignal> {
  const base: RegistrySignal = {
    package: name,
    exists: false,
    weeklyDownloads: 0,
    firstPublished: null,
    latestVersion: "",
    maintainerCount: 0,
    hasInstallScripts: false,
    ageInDays: 0,
    registryDependencies: {},
    isSecurityHolding: false,
    signals: [],
    riskScore: 0,
  };

  // Fetch registry metadata — request FULL document (not abbreviated)
  const meta = await fetchWithRetry(`${NPM_REGISTRY}/${encodeURIComponent(name)}`, MAX_RETRIES, {
    Accept: "application/json",
  });
  if (!meta) {
    base.signals.push("Package not found on npm (404) — may be unpublished, removed, or never existed");
    base.riskScore += 60;
    return base;
  }

  base.exists = true;

  // Parse metadata
  try {
    const data = await meta.json() as Record<string, any>;
    const latest = data["dist-tags"]?.latest ?? "";
    base.latestVersion = latest;
    const description = (data.description ?? "").toLowerCase();

    // ── Security holding package detection ──
    // npm security team replaces malicious packages with a placeholder
    // version like "0.0.1-security" and a specific description
    const isSecurityHolding =
      latest.includes("-security") ||
      description.includes("security holding") ||
      description.includes("malicious") ||
      description.includes("removed from the registry");

    if (isSecurityHolding) {
      base.isSecurityHolding = true;
      base.signals.push("CONFIRMED MALICIOUS — package was removed by npm security team and replaced with a security holding placeholder");
      base.riskScore += 80;
      console.log(`[package-analyzer:registry] ${name}: SECURITY HOLDING PACKAGE — confirmed malicious`);
      // Still continue to collect other signals for completeness
    }

    // First published date
    const times = data.time ?? {};
    const created = times.created ? new Date(times.created) : null;
    base.firstPublished = created;
    if (created) {
      base.ageInDays = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
    }

    // Maintainers
    const maintainers = data.maintainers ?? [];
    base.maintainerCount = maintainers.length;

    // Get latest version metadata — try versions map first, fall back to specific version endpoint
    let latestMeta = data.versions?.[latest] ?? {};

    // If versions map is missing (abbreviated metadata), fetch the specific version
    if (!data.versions && latest) {
      console.log(`[package-analyzer:registry] ${name}: versions map missing, fetching specific version ${latest}`);
      try {
        const versionResp = await fetchWithRetry(
          `${NPM_REGISTRY}/${encodeURIComponent(name)}/${latest}`,
          MAX_RETRIES,
          { Accept: "application/json" },
        );
        if (versionResp) {
          latestMeta = await versionResp.json() as Record<string, any>;
        }
      } catch {
        console.warn(`[package-analyzer:registry] ${name}: failed to fetch version-specific metadata`);
      }
    }

    const scripts = latestMeta.scripts ?? {};
    const installScripts = ["preinstall", "postinstall", "prepare", "preuninstall", "postuninstall"]
      .filter((s) => scripts[s]);
    base.hasInstallScripts = installScripts.length > 0;
    if (installScripts.length > 0) {
      base.installScriptContent = installScripts.map((s) => `${s}: ${scripts[s]}`).join("; ");
    }

    // Registry dependencies (used by dep-tree check)
    base.registryDependencies = latestMeta.dependencies ?? {};
    const depCount = Object.keys(base.registryDependencies).length;
    if (depCount > 0) {
      console.log(`[package-analyzer:registry] ${name}: found ${depCount} dependencies: ${Object.keys(base.registryDependencies).join(", ")}`);
    }

    // Deprecated check
    const deprecated = latestMeta.deprecated;

    // ── Scoring ──

    // Very new package (< 30 days)
    if (base.ageInDays > 0 && base.ageInDays < 30) {
      base.signals.push(`Very new package (${base.ageInDays} days old)`);
      base.riskScore += 25;
    }

    // Single maintainer + new (< 90 days)
    if (base.maintainerCount === 1 && base.ageInDays < 90) {
      base.signals.push(`Single maintainer and less than 90 days old`);
      base.riskScore += 15;
    }

    // Install scripts
    if (base.hasInstallScripts) {
      base.signals.push(`Has install scripts: ${installScripts.join(", ")}`);
      base.riskScore += 20;
    }

    // Deprecated
    if (deprecated) {
      base.signals.push("Package is deprecated");
      base.riskScore += 5;
    }
  } catch {
    base.signals.push("Failed to parse registry metadata");
    base.riskScore += 10;
  }

  // Fetch weekly downloads
  try {
    const dlResp = await fetchWithRetry(`${NPM_DOWNLOADS}/${encodeURIComponent(name)}`);
    if (dlResp) {
      const dlData = await dlResp.json() as Record<string, any>;
      base.weeklyDownloads = dlData.downloads ?? 0;

      if (base.weeklyDownloads < 100) {
        base.signals.push(`Very low downloads (${base.weeklyDownloads}/week)`);
        base.riskScore += 20;
      }
    }
  } catch {
    // Non-critical — continue without download data
  }

  return base;
}

async function fetchWithRetry(url: string, retries = MAX_RETRIES, headers?: Record<string, string>): Promise<Response | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await fetch(url, headers ? { headers } : undefined);
      if (resp.status === 404) return null;
      if (resp.status === 429) {
        const wait = Math.pow(2, attempt) * 1000;
        console.log(`[package-analyzer:registry] Rate limited, waiting ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (resp.ok) return resp;
    } catch (err) {
      if (attempt === retries - 1) {
        console.warn(`[package-analyzer:registry] Failed to fetch ${url}:`, err);
      }
    }
  }
  return null;
}
