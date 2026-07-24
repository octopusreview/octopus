/**
 * Offline review-quality eval harness. Runs nightly / in CI, never per-review.
 *
 * Loads the accept/reject feedback already persisted on findings
 * (`ReviewIssue.feedback`) and emits precision + false-positive rate by severity
 * and confidence. Recall is computed only from an explicit known-bug fixture set
 * (scripts/data/review-recall-fixtures.json) — feedback alone cannot measure
 * recall, so it is reported as null when no fixtures exist rather than faked.
 *
 * Writes a machine-readable report to scripts/data/review-eval-report.json and,
 * when a baseline exists, diffs against it and exits non-zero on a regression so
 * it can gate CI. Pass --update-baseline to record the current run as the new
 * baseline.
 *
 * Usage:
 *   bun run --cwd apps/web scripts/review-eval-harness.ts [--update-baseline] [--tolerance 0.05]
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { prisma } from "@octopus/db";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
import {
  computeLabelMetrics,
  computeRecall,
  diffAgainstBaseline,
  labelSufficiencyWarnings,
  type FeedbackLabel,
  type RecallFixture,
  type EvalReport,
} from "@/lib/review-eval";

const DATA_DIR = path.resolve(__dirname, "data");
const REPORT_PATH = path.join(DATA_DIR, "review-eval-report.json");
const BASELINE_PATH = path.join(DATA_DIR, "review-eval-baseline.json");
const FIXTURES_PATH = path.join(DATA_DIR, "review-recall-fixtures.json");

function parseArgs(): { updateBaseline: boolean; tolerance: number } {
  const args = process.argv.slice(2);
  let updateBaseline = false;
  let tolerance = 0.05;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--update-baseline") updateBaseline = true;
    else if (args[i] === "--tolerance" && args[i + 1]) tolerance = Number(args[++i]);
  }
  return { updateBaseline, tolerance };
}

function loadRecallFixtures(): RecallFixture[] {
  if (!fs.existsSync(FIXTURES_PATH)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(FIXTURES_PATH, "utf-8"));
    return Array.isArray(raw) ? (raw as RecallFixture[]) : [];
  } catch (e) {
    console.warn(`[eval] Could not parse ${FIXTURES_PATH}:`, e);
    return [];
  }
}

async function main() {
  const { updateBaseline, tolerance } = parseArgs();

  // High-confidence labels only: an explicit up/down feedback the team applied.
  const rows = await prisma.reviewIssue.findMany({
    where: { feedback: { in: ["up", "down"] } },
    select: { severity: true, confidence: true, feedback: true },
  });

  const labels: FeedbackLabel[] = rows.map((r) => ({
    severity: r.severity,
    confidence: r.confidence,
    feedback: r.feedback as "up" | "down",
  }));

  const labelMetrics = computeLabelMetrics(labels);
  const recall = computeRecall(loadRecallFixtures());
  const warnings = labelSufficiencyWarnings(labelMetrics);

  const report: EvalReport = {
    generatedAt: new Date().toISOString().slice(0, 10),
    labels: labelMetrics,
    recall,
    warnings,
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

  // ─── Human summary ───────────────────────────────────────────────────────
  const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
  console.log(`\n🐙 Review Eval — ${report.generatedAt}`);
  console.log(`   labelled findings: ${labelMetrics.overall.n} (up ${labelMetrics.overall.up} / down ${labelMetrics.overall.down})`);
  console.log(`   precision: ${pct(labelMetrics.overall.precision)}   fp-rate: ${pct(labelMetrics.overall.fpRate)}`);
  console.log(`   recall: ${pct(recall.recall)}${recall.recall === null ? " (no known-bug fixtures — see scripts/data/review-recall-fixtures.json)" : ` (${recall.matched}/${recall.expected})`}`);
  console.log(`   by severity:`);
  for (const [sev, b] of Object.entries(labelMetrics.bySeverity)) {
    console.log(`     ${sev.padEnd(9)} n=${String(b.n).padStart(4)}  precision=${pct(b.precision)}  fp=${pct(b.fpRate)}`);
  }
  if (warnings.length) {
    console.log(`   ⚠️  ${warnings.length} label-sufficiency warning(s):`);
    warnings.forEach((w) => console.log(`      - ${w}`));
  }

  if (updateBaseline) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(report, null, 2) + "\n");
    console.log(`\n✅ Baseline recorded at ${path.relative(process.cwd(), BASELINE_PATH)}`);
    await prisma.$disconnect();
    return;
  }

  // ─── CI gate: diff against baseline ──────────────────────────────────────
  if (fs.existsSync(BASELINE_PATH)) {
    const baseline: EvalReport = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8"));
    const regressions = diffAgainstBaseline(report, baseline, tolerance);
    if (regressions.length > 0) {
      console.error(`\n❌ ${regressions.length} regression(s) vs baseline (tolerance ${tolerance}):`);
      for (const r of regressions) {
        console.error(`   ${r.scope} ${r.metric}: ${pct(r.baseline)} → ${pct(r.current)} (Δ ${(r.delta * 100).toFixed(1)}pp)`);
      }
      await prisma.$disconnect();
      process.exit(1);
    }
    console.log(`\n✅ No regressions vs baseline (${baseline.generatedAt}).`);
  } else {
    console.log(`\nℹ️  No baseline yet. Run with --update-baseline to record one.`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
