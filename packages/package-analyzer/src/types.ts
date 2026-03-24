// ── Dependency diff ──────────────────────────────────────────────

export interface DependencyChange {
  name: string;
  version: string;
  previousVersion?: string;
  changeType: "added" | "updated" | "removed";
  isDevDependency: boolean;
  file: string; // which package.json (monorepo support)
}

// ── Registry metadata ────────────────────────────────────────────

export interface RegistrySignal {
  package: string;
  exists: boolean;
  weeklyDownloads: number;
  firstPublished: Date | null;
  latestVersion: string;
  maintainerCount: number;
  hasInstallScripts: boolean;
  installScriptContent?: string;
  ageInDays: number;
  /** Raw dependency map from the registry (used by dep-tree check) */
  registryDependencies: Record<string, string>;
  /** Package was replaced by npm security team with a security holding placeholder */
  isSecurityHolding: boolean;
  signals: string[];
  riskScore: number;
}

// ── Dependency tree ──────────────────────────────────────────────

export interface SuspiciousDep {
  name: string;
  reason: string;
}

export interface DepTreeSignal {
  package: string;
  suspiciousDeps: SuspiciousDep[];
  totalTransitiveDeps: number;
  categoryMismatch: boolean;
  signals: string[];
  riskScore: number;
}

// ── Typosquat ────────────────────────────────────────────────────

export interface TyposquatMatch {
  name: string;
  distance: number;
  weeklyDownloads: number;
}

export interface TyposquatSignal {
  package: string;
  similarTo: TyposquatMatch[];
  signals: string[];
  riskScore: number;
}

// ── Risk report ──────────────────────────────────────────────────

export type RiskLevel = "critical" | "high" | "medium" | "low" | "clean";

export interface RiskSignalDetail {
  source: "registry" | "dep-tree" | "typosquat";
  description: string;
  score: number;
}

export interface DependencyRiskReport {
  package: string;
  version: string;
  file: string;
  isDevDependency: boolean;
  overallRisk: RiskLevel;
  totalScore: number;
  signals: RiskSignalDetail[];
  recommendation: string;
  usedInCode: boolean;
  /** Package was confirmed malicious and removed by npm security team */
  isSecurityHolding: boolean;
}

// ── Config ───────────────────────────────────────────────────────

export interface PackageAnalyzerConfig {
  enabled: boolean;
  registryCheck: boolean;
  depTreeAnalysis: boolean;
  typosquatDetection: boolean;
  /** Findings below this score threshold are not reported (default: 36) */
  scoreThreshold: number;
  /** Private scopes — 404 on npm won't flag as critical */
  privateScopes: string[];
  /** Known-safe packages — skip analysis entirely */
  allowlist: string[];
}

export const DEFAULT_CONFIG: PackageAnalyzerConfig = {
  enabled: true,
  registryCheck: true,
  depTreeAnalysis: true,
  typosquatDetection: true,
  scoreThreshold: 36,
  privateScopes: [],
  allowlist: [],
};

// ── Progress events ──────────────────────────────────────────────

export type AnalysisStep =
  | "started"
  | "extracting"
  | "registry-check"
  | "typosquat-check"
  | "dep-tree-check"
  | "aggregating"
  | "completed"
  | "error";

export interface AnalysisProgressEvent {
  type: "dep-analysis-progress";
  analysisId: string;
  step: AnalysisStep;
  package?: string;
  message: string;
  progress?: { current: number; total: number };
  finding?: {
    package: string;
    risk: RiskLevel;
    score: number;
    signals: string[];
  };
}

export type ProgressCallback = (event: AnalysisProgressEvent) => void;
