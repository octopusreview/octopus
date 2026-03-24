import type {
  DependencyChange,
  DependencyRiskReport,
  PackageAnalyzerConfig,
  ProgressCallback,
  AnalysisProgressEvent,
} from "./types";
import { DEFAULT_CONFIG } from "./types";
import { extractDependencyChanges, extractAllDependencies } from "./dependency-diff";
import { checkRegistry } from "./registry-check";
import { checkTyposquat } from "./typosquat-check";
import { checkDepTree } from "./dep-tree-check";
import { aggregateRisk } from "./risk-aggregator";

// Re-export all types
export * from "./types";
export { extractDependencyChanges, extractAllDependencies } from "./dependency-diff";
export { fetchPackageSource, type PackageSource, type PackageSourceFile } from "./source-fetcher";

// ── PR Review Mode ───────────────────────────────────────────────

export interface AnalyzePrOptions {
  /** List of changed file paths in the PR */
  changedFiles: string[];
  /** Callback to fetch file content from a specific branch */
  getFileContent: (branch: string, path: string) => Promise<string | null>;
  baseBranch: string;
  headBranch: string;
  /** Full PR diff (used for usedInCode check) */
  diff?: string;
  config?: Partial<PackageAnalyzerConfig>;
  onProgress?: ProgressCallback;
}

/**
 * Analyze dependency changes in a PR.
 * Checks only added/updated dependencies against registry, dep-tree, and typosquat signals.
 */
export async function analyzePrDependencies(
  options: AnalyzePrOptions,
): Promise<DependencyRiskReport[]> {
  const config = { ...DEFAULT_CONFIG, ...options.config };
  const analysisId = generateId();
  const { onProgress } = options;

  if (!config.enabled) return [];

  const startTime = Date.now();
  console.log(`[package-analyzer] Starting PR dependency analysis (id: ${analysisId})`);

  // ── 1. Find package.json files in changed files ──
  const packageJsonFiles = options.changedFiles.filter(isPackageJson);
  if (packageJsonFiles.length === 0) {
    console.log("[package-analyzer] No package.json changes detected, skipping");
    return [];
  }

  onProgress?.({
    type: "dep-analysis-progress",
    analysisId,
    step: "started",
    message: `Analyzing dependencies in ${packageJsonFiles.length} package.json file${packageJsonFiles.length > 1 ? "s" : ""}...`,
  });

  console.log(`[package-analyzer] Found package.json changes: ${packageJsonFiles.join(", ")}`);

  // ── 2. Extract dependency changes ──
  onProgress?.({
    type: "dep-analysis-progress",
    analysisId,
    step: "extracting",
    message: "Parsing package.json changes...",
  });

  const allChanges: DependencyChange[] = [];
  for (const file of packageJsonFiles) {
    const [oldContent, newContent] = await Promise.all([
      options.getFileContent(options.baseBranch, file),
      options.getFileContent(options.headBranch, file),
    ]);
    const changes = extractDependencyChanges(oldContent, newContent, file);
    allChanges.push(...changes);
  }

  const actionable = allChanges.filter((c) => c.changeType !== "removed");
  if (actionable.length === 0) {
    console.log("[package-analyzer] No new/updated dependencies found, skipping");
    return [];
  }

  // Filter out allowlisted packages
  const filtered = actionable.filter((d) => !config.allowlist.includes(d.name));
  const added = filtered.filter((d) => d.changeType === "added").length;
  const updated = filtered.filter((d) => d.changeType === "updated").length;

  console.log(`[package-analyzer] Extracted ${added} new deps, ${updated} updated deps`);
  onProgress?.({
    type: "dep-analysis-progress",
    analysisId,
    step: "extracting",
    message: `Found ${added} new and ${updated} updated dependencies`,
  });

  // ── 3. Run analyses ──
  return runAnalysis(filtered, options.diff, config, analysisId, onProgress, startTime);
}

// ── Public Repo Mode ─────────────────────────────────────────────

export interface AnalyzeRepoOptions {
  /** All package.json files with their contents */
  packageJsonContents: { file: string; content: string }[];
  config?: Partial<PackageAnalyzerConfig>;
  onProgress?: ProgressCallback;
}

/**
 * Analyze all dependencies in a repository (no PR diff needed).
 * Treats every dependency as "added" for analysis purposes.
 */
export async function analyzeRepositoryDependencies(
  options: AnalyzeRepoOptions,
): Promise<DependencyRiskReport[]> {
  const config = { ...DEFAULT_CONFIG, ...options.config, scoreThreshold: 0 };
  const analysisId = generateId();
  const { onProgress } = options;

  const startTime = Date.now();
  console.log(`[package-analyzer] Starting repository dependency analysis (id: ${analysisId})`);

  onProgress?.({
    type: "dep-analysis-progress",
    analysisId,
    step: "started",
    message: `Analyzing dependencies in ${options.packageJsonContents.length} package.json file${options.packageJsonContents.length > 1 ? "s" : ""}...`,
  });

  // ── Extract all dependencies ──
  onProgress?.({
    type: "dep-analysis-progress",
    analysisId,
    step: "extracting",
    message: "Parsing package.json files...",
  });

  const allDeps: DependencyChange[] = [];
  for (const { file, content } of options.packageJsonContents) {
    const deps = extractAllDependencies(content, file);
    allDeps.push(...deps);
  }

  if (allDeps.length === 0) {
    console.log("[package-analyzer] No dependencies found");
    return [];
  }

  // Filter allowlisted
  const filtered = allDeps.filter((d) => !config.allowlist.includes(d.name));

  console.log(`[package-analyzer] Extracted ${filtered.length} dependencies to analyze`);
  onProgress?.({
    type: "dep-analysis-progress",
    analysisId,
    step: "extracting",
    message: `Found ${filtered.length} dependencies to analyze`,
  });

  // Return ALL results (including clean) for the repo mode
  return runAnalysis(filtered, undefined, config, analysisId, onProgress, startTime);
}

// ── Shared analysis pipeline ─────────────────────────────────────

async function runAnalysis(
  deps: DependencyChange[],
  diff: string | undefined,
  config: PackageAnalyzerConfig,
  analysisId: string,
  onProgress?: ProgressCallback,
  startTime?: number,
): Promise<DependencyRiskReport[]> {
  // ── Registry check (must run first — other checks depend on it) ──
  const registryResults = config.registryCheck
    ? await checkRegistry(deps, analysisId, onProgress)
    : [];

  // ── Early exit: if any package is a confirmed security holding, stop immediately ──
  const securityHoldings = registryResults.filter((r) => r.isSecurityHolding);
  if (securityHoldings.length > 0) {
    const holdingNames = securityHoldings.map((r) => r.package);
    console.log(`[package-analyzer] CRITICAL — confirmed malicious package(s) detected: ${holdingNames.join(", ")}. Skipping further analysis.`);

    onProgress?.({
      type: "dep-analysis-progress",
      analysisId,
      step: "completed",
      message: `CRITICAL — confirmed malicious package(s) found: ${holdingNames.join(", ")}. Further analysis skipped.`,
    });

    // Only aggregate the security holdings, skip typosquat + dep-tree for speed
    const reports = aggregateRisk(deps, registryResults, [], [], diff, config, analysisId, onProgress);
    const elapsed = startTime ? ((Date.now() - startTime) / 1000).toFixed(1) : "?";
    console.log(`[package-analyzer] Early exit in ${elapsed}s — ${securityHoldings.length} confirmed malicious package(s)`);
    return reports.filter((r) => r.totalScore >= config.scoreThreshold);
  }

  // ── Typosquat + Dep tree (can run in parallel, both depend on registry) ──
  const [typosquatResults, depTreeResults] = await Promise.all([
    config.typosquatDetection
      ? checkTyposquat(deps, registryResults, analysisId, onProgress)
      : Promise.resolve([]),
    config.depTreeAnalysis
      ? Promise.resolve(checkDepTree(deps, registryResults, analysisId, onProgress))
      : Promise.resolve([]),
  ]);

  // ── Aggregate risk scores ──
  const reports = aggregateRisk(
    deps,
    registryResults,
    depTreeResults,
    typosquatResults,
    diff,
    config,
    analysisId,
    onProgress,
  );

  // ── Filter by threshold ──
  const filtered = reports.filter((r) => r.totalScore >= config.scoreThreshold);

  const elapsed = startTime ? ((Date.now() - startTime) / 1000).toFixed(1) : "?";
  const critical = filtered.filter((r) => r.overallRisk === "critical").length;
  const high = filtered.filter((r) => r.overallRisk === "high").length;
  const medium = filtered.filter((r) => r.overallRisk === "medium").length;
  const clean = reports.length - filtered.length;

  const summary = `Analysis complete: ${critical} critical, ${high} high, ${medium} medium, ${clean} clean`;
  console.log(`[package-analyzer] ${summary} (${elapsed}s)`);

  onProgress?.({
    type: "dep-analysis-progress",
    analysisId,
    step: "completed",
    message: summary,
  });

  // Send individual finding events for risky packages
  for (const report of filtered) {
    if (report.overallRisk !== "clean") {
      onProgress?.({
        type: "dep-analysis-progress",
        analysisId,
        step: "completed",
        package: report.package,
        message: `${report.package}: ${report.overallRisk.toUpperCase()} (score: ${report.totalScore})`,
        finding: {
          package: report.package,
          risk: report.overallRisk,
          score: report.totalScore,
          signals: report.signals.map((s) => s.description),
        },
      });
    }
  }

  return filtered;
}

// ── Formatting helper for review integration ─────────────────────

/**
 * Format dependency risk reports into a context string for the LLM review prompt.
 */
export function formatDependencyFindings(reports: DependencyRiskReport[]): string {
  if (reports.length === 0) return "";

  const RISK_EMOJI: Record<string, string> = {
    critical: "🔴",
    high: "🟠",
    medium: "🟡",
    low: "🔵",
    clean: "✅",
  };

  const lines: string[] = [
    "<dependency_security>",
    "The following dependency risk analysis results were detected for packages added/updated in this PR.",
    "For any finding with risk level HIGH or CRITICAL:",
    "1. Create a CRITICAL or HIGH severity finding in your review",
    "2. Reference the specific package and the signals that triggered the alert",
    "3. Recommend removal or replacement with a legitimate alternative",
    "4. If the package is imported but never used in code, explicitly flag this",
    "",
    "Dependency Risk Analysis Results:",
    "",
  ];

  for (const report of reports) {
    const emoji = RISK_EMOJI[report.overallRisk] ?? "❓";
    lines.push(`### ${emoji} ${report.overallRisk.toUpperCase()} — \`${report.package}@${report.version}\``);
    lines.push(`- **File:** \`${report.file}\``);
    lines.push(`- **Risk Score:** ${report.totalScore}/100`);
    lines.push(`- **Used in code:** ${report.usedInCode ? "Yes" : "No"}`);

    if (report.signals.length > 0) {
      lines.push("- **Signals:**");
      for (const s of report.signals) {
        lines.push(`  - ⚠️ [${s.source}] ${s.description}`);
      }
    }

    lines.push(`- **Recommendation:** ${report.recommendation}`);
    lines.push("");
  }

  lines.push("</dependency_security>");
  return lines.join("\n");
}

// ── Utilities ────────────────────────────────────────────────────

function isPackageJson(path: string): boolean {
  // Match **/package.json but NOT lock files or node_modules
  return (
    path.endsWith("/package.json") ||
    path === "package.json"
  ) &&
    !path.includes("node_modules") &&
    !path.includes("package-lock.json");
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}
