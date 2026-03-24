import type {
  DependencyChange,
  RegistrySignal,
  DepTreeSignal,
  TyposquatSignal,
  DependencyRiskReport,
  RiskLevel,
  RiskSignalDetail,
  PackageAnalyzerConfig,
  ProgressCallback,
} from "./types";

/**
 * Aggregate risk signals from all analyzers into a single report per package.
 */
export function aggregateRisk(
  deps: DependencyChange[],
  registry: RegistrySignal[],
  depTree: DepTreeSignal[],
  typosquat: TyposquatSignal[],
  diff: string | undefined,
  config: PackageAnalyzerConfig,
  analysisId: string,
  onProgress?: ProgressCallback,
): DependencyRiskReport[] {
  onProgress?.({
    type: "dep-analysis-progress",
    analysisId,
    step: "aggregating",
    message: "Calculating risk scores...",
  });

  const registryMap = new Map(registry.map((r) => [r.package, r]));
  const depTreeMap = new Map(depTree.map((d) => [d.package, d]));
  const typosquatMap = new Map(typosquat.map((t) => [t.package, t]));

  const reports: DependencyRiskReport[] = [];
  const seen = new Set<string>();

  for (const dep of deps) {
    if (dep.changeType === "removed") continue;
    if (seen.has(dep.name)) continue;
    seen.add(dep.name);

    // Skip allowlisted packages
    if (config.allowlist.includes(dep.name)) continue;

    const signals: RiskSignalDetail[] = [];
    let totalScore = 0;

    // ── Registry signals ──
    const reg = registryMap.get(dep.name);
    if (reg) {
      for (const s of reg.signals) {
        signals.push({ source: "registry", description: s, score: 0 });
      }
      totalScore += reg.riskScore;
    }

    // ── Dep tree signals ──
    const tree = depTreeMap.get(dep.name);
    if (tree) {
      for (const s of tree.signals) {
        signals.push({ source: "dep-tree", description: s, score: 0 });
      }
      totalScore += tree.riskScore;
    }

    // ── Typosquat signals ──
    const typo = typosquatMap.get(dep.name);
    if (typo) {
      for (const s of typo.signals) {
        signals.push({ source: "typosquat", description: s, score: 0 });
      }
      totalScore += typo.riskScore;
    }

    // ── Combo bonuses — dangerous signal combinations ──
    const isVeryNew = reg && reg.ageInDays >= 0 && reg.ageInDays < 30;
    const hasTyposquatSignal = typo && typo.riskScore > 0;
    const hasDepTreeSignal = tree && tree.riskScore > 0;
    const hasLowDownloads = reg && reg.weeklyDownloads < 100;

    // New package + typosquat = almost certainly malicious
    if (isVeryNew && hasTyposquatSignal) {
      signals.push({
        source: "registry",
        description: `Dangerous combo: very new package (${reg!.ageInDays} days) with typosquat signals`,
        score: 30,
      });
      totalScore += 30;
    }

    // New + low downloads + typosquat = extremely suspicious
    if (isVeryNew && hasLowDownloads && hasTyposquatSignal) {
      signals.push({
        source: "registry",
        description: "Extremely suspicious: new package, low downloads, and similar to known package",
        score: 20,
      });
      totalScore += 20;
    }

    // Typosquat + suspicious dep tree = supply chain attack pattern
    if (hasTyposquatSignal && hasDepTreeSignal) {
      signals.push({
        source: "dep-tree",
        description: "Supply chain attack pattern: typosquat name with suspicious dependencies",
        score: 25,
      });
      totalScore += 25;
    }

    // ── Bonus: imported but not used ──
    const usedInCode = diff ? isPackageUsedInCode(dep.name, diff) : false;
    if (diff && !usedInCode && dep.changeType === "added") {
      signals.push({
        source: "registry",
        description: "Package is added to dependencies but never imported/required in code",
        score: 15,
      });
      totalScore += 15;
    }

    // ── DevDependency discount (50%) ──
    // Do NOT discount if the package doesn't exist on npm — a non-existent
    // devDependency is just as suspicious as a non-existent regular dependency
    const packageNotOnNpm = reg && !reg.exists;
    if (dep.isDevDependency && !packageNotOnNpm) {
      totalScore = Math.round(totalScore * 0.5);
    }

    // ── Private scope — downgrade severity ──
    const isPrivateScope = config.privateScopes.some((scope) =>
      dep.name.startsWith(scope + "/") || dep.name.startsWith(scope),
    );
    if (isPrivateScope && !reg?.exists) {
      // Don't flag private packages as critical just because npm returns 404
      totalScore = Math.min(totalScore, 35); // cap at "low"
      signals.push({
        source: "registry",
        description: "Private scope package — npm 404 is expected, manual review recommended",
        score: 0,
      });
    }

    // Assign individual scores to signals for transparency
    distributeScores(signals, totalScore);

    const recommendation = buildRecommendation(dep.name, scoreToRisk(totalScore), signals, reg, typo);

    const isSecurityHolding = reg?.isSecurityHolding ?? false;

    // Security holding packages: don't discount, always CRITICAL
    if (isSecurityHolding) {
      totalScore = Math.max(totalScore, 100);
    }

    // Also don't apply devDep discount to security holding packages
    const finalRisk = isSecurityHolding ? "critical" as const : scoreToRisk(totalScore);

    reports.push({
      package: dep.name,
      version: dep.version,
      file: dep.file,
      isDevDependency: dep.isDevDependency,
      overallRisk: finalRisk,
      totalScore,
      signals,
      recommendation: isSecurityHolding
        ? `🔴 CONFIRMED MALICIOUS — Remove \`${dep.name}\` immediately! This package was flagged and removed by the npm security team. Check npmjs.com/advisories for details.`
        : recommendation,
      usedInCode,
      isSecurityHolding,
    });

    console.log(`[package-analyzer:risk] ${dep.name} → ${finalRisk.toUpperCase()} (score: ${totalScore})`);
  }

  // Sort by score descending (most risky first)
  reports.sort((a, b) => b.totalScore - a.totalScore);

  return reports;
}

// ── Helpers ──────────────────────────────────────────────────────

function scoreToRisk(score: number): RiskLevel {
  if (score >= 76) return "critical";
  if (score >= 56) return "high";
  if (score >= 36) return "medium";
  if (score >= 16) return "low";
  return "clean";
}

function isPackageUsedInCode(name: string, diff: string): boolean {
  // Check for import/require patterns in the diff
  const patterns = [
    new RegExp(`from\\s+['"]${escapeRegex(name)}['"]`),
    new RegExp(`from\\s+['"]${escapeRegex(name)}/`),
    new RegExp(`require\\s*\\(\\s*['"]${escapeRegex(name)}['"]\\s*\\)`),
    new RegExp(`require\\s*\\(\\s*['"]${escapeRegex(name)}/`),
    new RegExp(`import\\s+['"]${escapeRegex(name)}['"]`),
  ];
  return patterns.some((p) => p.test(diff));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function distributeScores(signals: RiskSignalDetail[], total: number): void {
  if (signals.length === 0) return;
  const perSignal = Math.round(total / signals.length);
  let remaining = total;
  for (let i = 0; i < signals.length; i++) {
    if (i === signals.length - 1) {
      signals[i].score = remaining;
    } else {
      signals[i].score = perSignal;
      remaining -= perSignal;
    }
  }
}

const RISK_EMOJI: Record<RiskLevel, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
  clean: "✅",
};

function buildRecommendation(
  name: string,
  risk: RiskLevel,
  signals: RiskSignalDetail[],
  registry?: RegistrySignal,
  typo?: TyposquatSignal,
): string {
  if (risk === "clean") return `${name} appears safe — no suspicious signals detected.`;

  const parts: string[] = [];

  if (risk === "critical" || risk === "high") {
    parts.push(`${RISK_EMOJI[risk]} Remove \`${name}\` immediately and investigate.`);
  } else {
    parts.push(`${RISK_EMOJI[risk]} Review \`${name}\` before merging.`);
  }

  // Suggest alternative if typosquat detected
  if (typo && typo.similarTo.length > 0) {
    const best = typo.similarTo.sort((a, b) => b.weeklyDownloads - a.weeklyDownloads)[0];
    parts.push(
      `If you intended to use "${best.name}" (${formatDownloads(best.weeklyDownloads)} downloads/week), replace with the correct package name.`,
    );
  }

  // Mention key signals
  const keySignals = signals
    .filter((s) => s.score > 10)
    .map((s) => s.description);
  if (keySignals.length > 0) {
    parts.push(`Key concerns: ${keySignals.join("; ")}`);
  }

  return parts.join(" ");
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
