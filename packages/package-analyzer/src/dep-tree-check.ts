import type { DependencyChange, RegistrySignal, DepTreeSignal, ProgressCallback } from "./types";

// ── Suspicious sub-dependency categories ──

const SUSPICIOUS_DEPS: Record<string, { packages: string[]; label: string }> = {
  execution: {
    packages: [
      "execp", "exec-sh", "shell-exec", "child-process", "node-pty",
      "cross-spawn-async", "shelljs", "execa", "exec-sync",
    ],
    label: "command execution capability",
  },
  filesystem: {
    packages: ["fs-extra", "graceful-fs", "rimraf"],
    label: "filesystem access",
  },
  network: {
    packages: [
      "axios", "request", "node-fetch", "got", "superagent",
      "needle", "urllib", "https-proxy-agent",
    ],
    label: "network access",
  },
  datastore: {
    packages: [
      "sqlite3", "better-sqlite3", "leveldown", "nedb",
      "lowdb", "keyv",
    ],
    label: "data store access",
  },
  crypto: {
    packages: ["crypto-js", "bcrypt", "node-rsa", "openpgp"],
    label: "crypto/encoding (exfiltration indicator)",
  },
  sysinfo: {
    packages: [
      "systeminformation", "os-name", "username", "hostname",
      "public-ip", "internal-ip",
    ],
    label: "system info gathering",
  },
};

// All suspicious package names for quick lookup
const SUSPICIOUS_SET = new Set(
  Object.values(SUSPICIOUS_DEPS).flatMap((c) => c.packages),
);

// ── Category expectations based on package name ──

interface CategoryExpectation {
  patterns: RegExp[];
  expected: string[];    // categories that ARE expected
  unexpected: string[];  // categories that are NOT expected
}

const CATEGORY_EXPECTATIONS: CategoryExpectation[] = [
  {
    patterns: [/json/i, /parse/i, /format/i, /lint/i, /pretty/i, /valid/i],
    expected: [],
    unexpected: ["execution", "network", "datastore"],
  },
  {
    patterns: [/http/i, /request/i, /api/i, /fetch/i, /client/i],
    expected: ["network"],
    unexpected: ["execution", "datastore"],
  },
  {
    patterns: [/cli/i, /tool/i, /bin/i],
    expected: ["execution"],
    unexpected: [], // cli tools can have anything, but combo flagging still applies
  },
  {
    patterns: [/color/i, /chalk/i, /style/i, /css/i, /ui/i],
    expected: [],
    unexpected: ["execution", "network", "datastore", "sysinfo"],
  },
  {
    patterns: [/util/i, /helper/i, /lodash/i, /underscore/i],
    expected: [],
    unexpected: ["execution", "network", "datastore"],
  },
];

/**
 * Analyze the dependency tree of each package, looking for suspicious
 * sub-dependencies and category mismatches.
 */
export function checkDepTree(
  deps: DependencyChange[],
  registryData: RegistrySignal[],
  analysisId: string,
  onProgress?: ProgressCallback,
): DepTreeSignal[] {
  const toCheck = deps.filter((d) => d.changeType !== "removed");
  if (toCheck.length === 0) return [];

  // Build registry lookup
  const registryMap = new Map<string, RegistrySignal>();
  for (const r of registryData) registryMap.set(r.package, r);

  const results: DepTreeSignal[] = [];
  const seen = new Set<string>();

  for (const dep of toCheck) {
    if (seen.has(dep.name)) continue;
    seen.add(dep.name);

    const reg = registryMap.get(dep.name);
    if (!reg?.exists) continue; // Can't analyze non-existent packages

    onProgress?.({
      type: "dep-analysis-progress",
      analysisId,
      step: "dep-tree-check",
      package: dep.name,
      message: `Analyzing dependency tree for ${dep.name}...`,
    });

    const signal = analyzeSinglePackage(dep.name, reg);
    results.push(signal);

    if (signal.riskScore > 0) {
      console.log(
        `[package-analyzer:dep-tree] ${dep.name}: score=${signal.riskScore} — ${signal.signals.join("; ")}`,
      );
      onProgress?.({
        type: "dep-analysis-progress",
        analysisId,
        step: "dep-tree-check",
        package: dep.name,
        message: `${dep.name}: ${signal.signals.join("; ")}`,
      });
    }
  }

  return results;
}

function analyzeSinglePackage(name: string, registry: RegistrySignal): DepTreeSignal {
  const subDeps = Object.keys(registry.registryDependencies);
  const signal: DepTreeSignal = {
    package: name,
    suspiciousDeps: [],
    totalTransitiveDeps: subDeps.length,
    categoryMismatch: false,
    signals: [],
    riskScore: 0,
  };

  // ── Find suspicious sub-dependencies ──
  const foundCategories = new Set<string>();

  for (const subDep of subDeps) {
    if (!SUSPICIOUS_SET.has(subDep)) continue;

    for (const [category, info] of Object.entries(SUSPICIOUS_DEPS)) {
      if (info.packages.includes(subDep)) {
        foundCategories.add(category);
        signal.suspiciousDeps.push({ name: subDep, reason: info.label });
      }
    }
  }

  // ── Score individual suspicious deps ──
  if (foundCategories.has("execution")) {
    signal.signals.push(
      `Has command execution sub-dependency: ${signal.suspiciousDeps.filter((d) => d.reason === "command execution capability").map((d) => d.name).join(", ")}`,
    );
    signal.riskScore += 35;
  }

  // ── Category mismatch detection ──
  const unexpectedCategories = getUnexpectedCategories(name, foundCategories);
  if (unexpectedCategories.length > 0) {
    signal.categoryMismatch = true;
    const cats = unexpectedCategories.map((c) => {
      const depNames = signal.suspiciousDeps
        .filter((d) => SUSPICIOUS_DEPS[c]?.packages.includes(d.name))
        .map((d) => d.name);
      return `${c} (${depNames.join(", ")})`;
    });
    signal.signals.push(`Category mismatch — unexpected capabilities: ${cats.join(", ")}`);
    signal.riskScore += 30;
  }

  // ── Excessive sub-dependencies for a simple utility ──
  const isSimpleUtil = /^(is-|has-|to-|get-|set-|pad-|trim-)/.test(name) ||
    name.split("-").length <= 2;
  if (isSimpleUtil && subDeps.length > 10) {
    signal.signals.push(`Excessive sub-dependencies for a simple utility (${subDeps.length} deps)`);
    signal.riskScore += 10;
  }

  // ── Dangerous combos ──
  if (foundCategories.has("network") && foundCategories.has("execution")) {
    signal.signals.push("Dangerous combo: network + command execution");
    signal.riskScore += 25;
  }
  if (foundCategories.has("filesystem") && foundCategories.has("network")) {
    signal.signals.push("Suspicious combo: filesystem + network (read & exfiltrate pattern)");
    signal.riskScore += 20;
  }

  return signal;
}

function getUnexpectedCategories(
  packageName: string,
  foundCategories: Set<string>,
): string[] {
  for (const expectation of CATEGORY_EXPECTATIONS) {
    const matches = expectation.patterns.some((p) => p.test(packageName));
    if (matches) {
      return expectation.unexpected.filter((cat) => foundCategories.has(cat));
    }
  }
  return [];
}
