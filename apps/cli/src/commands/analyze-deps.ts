import { loadCredentials } from "../lib/credentials.js";
import { streamSse } from "../lib/api.js";
import { positionals } from "../lib/args.js";
import {
  c,
  heading,
  table,
  info,
  success,
  error,
  sanitizeTerminal,
} from "../lib/output.js";

/**
 * `octp analyze-deps <repo-url>` — scan a GitHub repo's npm dependencies for
 * supply-chain risk. Ported from the old commander-based CLI; same server
 * endpoint (`/api/analyze-deps`), same SSE event names, same CI exit-code
 * contract:
 *   - any CRITICAL advisory → exit 2
 *   - else any HIGH advisory → exit 1
 *   - else                   → exit 0
 *   - stream/transport error → exit 1
 *
 * Progress + per-finding live lines go to STDERR (so piping stdout stays
 * machine-clean); the final report + summary go to STDOUT.
 */

type RiskSignal = { source: string; description: string; score: number };

type RiskReport = {
  package: string;
  version: string;
  file: string;
  isDevDependency: boolean;
  overallRisk: string;
  totalScore: number;
  signals: RiskSignal[];
  recommendation: string;
  isSecurityHolding: boolean;
};

const RISK_LABEL: Record<string, (s: string) => string> = {
  critical: (s) => c.red(s),
  // The old CLI used a custom orange hex; the slim output lib only exposes a
  // fixed palette, so HIGH renders yellow here. Severity is still distinct
  // (CRITICAL=red, HIGH/MEDIUM=yellow text, LOW=cyan, CLEAN=green).
  high: (s) => c.yellow(s),
  medium: (s) => c.yellow(s),
  low: (s) => c.cyan(s),
  clean: (s) => c.green(s),
};

function riskLabel(risk: string): string {
  const paint = RISK_LABEL[risk];
  const text = risk.toUpperCase();
  return paint ? paint(text) : text;
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback;
}

function asBool(v: unknown): boolean {
  return v === true;
}

function toReport(v: unknown): RiskReport {
  const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  const rawSignals = Array.isArray(o.signals) ? o.signals : [];
  const signals: RiskSignal[] = rawSignals.map((s) => {
    const so = (typeof s === "object" && s !== null ? s : {}) as Record<string, unknown>;
    return {
      source: asString(so.source),
      description: asString(so.description),
      score: asNumber(so.score),
    };
  });
  return {
    package: asString(o.package),
    version: asString(o.version),
    file: asString(o.file),
    isDevDependency: asBool(o.isDevDependency),
    overallRisk: asString(o.overallRisk, "unknown"),
    totalScore: asNumber(o.totalScore),
    signals,
    recommendation: asString(o.recommendation),
    isSecurityHolding: asBool(o.isSecurityHolding),
  };
}

function printHelp(): void {
  console.log(`octp analyze-deps — scan a GitHub repo's npm dependencies for supply-chain risk

Usage:
  octp analyze-deps <repo-url>

Arguments:
  <repo-url>   GitHub repository URL (e.g. https://github.com/owner/repo)

Exit codes:
  0   no high/critical advisories
  1   at least one HIGH advisory (and no critical), or a runtime/stream error
  2   at least one CRITICAL advisory, or a usage/auth error
`);
}

export async function analyzeDepsCommand(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }

  const creds = await loadCredentials();
  if (!creds) {
    error("Not signed in. Run `octp login`.");
    return 2;
  }

  const repoUrl = positionals(argv)[0];
  if (!repoUrl || repoUrl.trim().length === 0) {
    error("Missing <repo-url>.");
    printHelp();
    return 2;
  }

  // State collected from the stream.
  let reports: RiskReport[] = [];
  let repoName = "";
  let cached = false;
  let analysisId = "";
  let streamError: string | null = null;

  process.stderr.write("Starting package analysis...\n");

  const result = await streamSse(
    `${creds.baseUrl}/api/analyze-deps`,
    { repoUrl: repoUrl.trim() },
    creds.token,
    (event, data) => {
      switch (event) {
        case "progress": {
          const message = asString(data.message, "Analyzing...");
          process.stderr.write(`${c.dim("…")} ${sanitizeTerminal(message)}\n`);
          break;
        }
        case "finding": {
          // The `finding` event payload is { package, risk, score } — distinct
          // from the full RiskReport delivered on `complete`. Read those fields
          // directly (overallRisk/totalScore don't exist on this event).
          const pkg = asString(data.package);
          const risk = asString(data.risk, "unknown");
          const score = asNumber(data.score);
          process.stderr.write(`${riskLabel(risk)} ${sanitizeTerminal(pkg)} (score: ${score})\n`);
          break;
        }
        case "complete": {
          reports = Array.isArray(data.reports) ? data.reports.map(toReport) : [];
          repoName = asString(data.repoName);
          cached = asBool(data.cached);
          analysisId = asString(data.analysisId);
          break;
        }
        case "error": {
          streamError = asString(data.message, "Analysis failed");
          break;
        }
      }
    },
  );

  // Transport-level failure (couldn't open or read the stream).
  if (!result.ok) {
    error(`Analysis request failed (HTTP ${result.status}): ${result.error}`);
    return 1;
  }

  // Server-emitted error event.
  if (streamError) {
    error(sanitizeTerminal(streamError));
    return 1;
  }

  if (cached) {
    process.stderr.write(`${c.green("✓")} Found cached analysis (same commit hash)\n`);
  } else {
    process.stderr.write(`${c.green("✓")} Analysis complete\n`);
  }

  if (reports.length === 0) {
    success(`All dependencies look clean!${repoName ? ` (${repoName})` : ""}`);
    return 0;
  }

  // Severity tallies.
  const critical = reports.filter((r) => r.overallRisk === "critical").length;
  const high = reports.filter((r) => r.overallRisk === "high").length;
  const medium = reports.filter((r) => r.overallRisk === "medium").length;
  const low = reports.filter((r) => r.overallRisk === "low").length;
  const clean = reports.filter((r) => r.overallRisk === "clean").length;

  const parts: string[] = [];
  if (critical) parts.push(c.red(`${critical} critical`));
  if (high) parts.push(c.yellow(`${high} high`));
  if (medium) parts.push(c.yellow(`${medium} medium`));
  if (low) parts.push(c.cyan(`${low} low`));
  if (clean) parts.push(c.green(`${clean} clean`));
  info(`${reports.length} packages: ${parts.join(", ")}`);

  // Table for risky packages.
  const risky = reports.filter((r) => r.overallRisk !== "clean");
  if (risky.length > 0) {
    console.log("");
    table(
      risky.map((r) => [
        riskLabel(r.overallRisk),
        sanitizeTerminal(r.package),
        String(r.totalScore),
        sanitizeTerminal(r.file),
        sanitizeTerminal(r.signals.map((s) => s.description).join("; ")).slice(0, 80),
      ]),
      ["Risk", "Package", "Score", "File", "Signals"],
    );
  }

  // Detailed findings for critical/high.
  const urgent = reports.filter((r) => r.overallRisk === "critical" || r.overallRisk === "high");
  if (urgent.length > 0) {
    heading("Detailed Findings");
    for (const report of urgent) {
      console.log("");
      console.log(
        `  ${riskLabel(report.overallRisk)} ${c.bold(sanitizeTerminal(report.package))}@${sanitizeTerminal(report.version)} (score: ${report.totalScore})`,
      );
      console.log(`  ${c.dim(sanitizeTerminal(report.file))}`);
      if (report.isSecurityHolding) {
        console.log(`  ${c.red("⚠ CONFIRMED MALICIOUS — removed by npm security team")}`);
      }
      for (const signal of report.signals) {
        console.log(
          `    ${c.yellow("⚠")} [${sanitizeTerminal(signal.source)}] ${sanitizeTerminal(signal.description)}`,
        );
      }
      if (report.recommendation) {
        console.log(`    ${c.dim("→")} ${sanitizeTerminal(report.recommendation)}`);
      }
    }
  }

  if (analysisId) {
    console.log("");
    info(`Analysis ID: ${sanitizeTerminal(analysisId)}`);
  }

  // CI exit-code contract — preserved from the old command.
  if (critical > 0) return 2;
  if (high > 0) return 1;
  return 0;
}
