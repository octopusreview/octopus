/**
 * Offline review-quality metrics. Pure functions only — no DB, no fs — so they
 * are unit-testable and reusable by the harness script and any CI gate.
 *
 * Precision + false-positive rate come from persisted accept/reject feedback on
 * findings that were actually surfaced (`ReviewIssue.feedback`). RECALL cannot
 * be derived from that signal alone — feedback only exists on findings we DID
 * report, never on bugs we missed — so recall is computed separately against an
 * explicit fixture set of known-bug PRs (see `computeRecall`). When no fixtures
 * are supplied, recall is reported as `null`, not silently assumed.
 */

export type Feedback = "up" | "down";

export interface FeedbackLabel {
  severity: string; // critical | high | medium | low
  confidence: string | null; // HIGH | MEDIUM | LOW | null
  feedback: Feedback;
}

export interface Bucket {
  /** labelled findings in this bucket */
  n: number;
  up: number;
  down: number;
  /** up / n — share the team judged valuable. null when n === 0. */
  precision: number | null;
  /** down / n — share the team judged unhelpful. null when n === 0. */
  fpRate: number | null;
}

export interface LabelMetrics {
  overall: Bucket;
  bySeverity: Record<string, Bucket>;
  byConfidence: Record<string, Bucket>;
}

function bucket(labels: FeedbackLabel[]): Bucket {
  const up = labels.filter((l) => l.feedback === "up").length;
  const down = labels.filter((l) => l.feedback === "down").length;
  const n = up + down;
  return {
    n,
    up,
    down,
    precision: n === 0 ? null : up / n,
    fpRate: n === 0 ? null : down / n,
  };
}

function groupBy(labels: FeedbackLabel[], key: (l: FeedbackLabel) => string): Record<string, Bucket> {
  const groups: Record<string, FeedbackLabel[]> = {};
  for (const l of labels) {
    const k = key(l);
    (groups[k] ??= []).push(l);
  }
  const out: Record<string, Bucket> = {};
  for (const [k, v] of Object.entries(groups)) out[k] = bucket(v);
  return out;
}

export function computeLabelMetrics(labels: FeedbackLabel[]): LabelMetrics {
  return {
    overall: bucket(labels),
    bySeverity: groupBy(labels, (l) => l.severity || "unknown"),
    byConfidence: groupBy(labels, (l) => l.confidence ?? "unset"),
  };
}

/**
 * A known-bug fixture: the finding signatures a reviewer SHOULD surface for a PR
 * (`expected`) and the signatures it actually surfaced on replay (`reported`).
 * Populated offline from labelled real PRs; kept in the repo so recall is
 * reproducible without the live review engine.
 */
export interface RecallFixture {
  name: string;
  expected: string[];
  reported: string[];
}

export interface RecallResult {
  recall: number | null; // matched / expected across all fixtures; null if none
  matched: number;
  expected: number;
  byFixture: { name: string; recall: number | null; matched: number; expected: number }[];
}

export function computeRecall(fixtures: RecallFixture[]): RecallResult {
  if (fixtures.length === 0) {
    return { recall: null, matched: 0, expected: 0, byFixture: [] };
  }
  let totalMatched = 0;
  let totalExpected = 0;
  const byFixture = fixtures.map((f) => {
    const reported = new Set(f.reported);
    const matched = f.expected.filter((s) => reported.has(s)).length;
    totalMatched += matched;
    totalExpected += f.expected.length;
    return {
      name: f.name,
      matched,
      expected: f.expected.length,
      recall: f.expected.length === 0 ? null : matched / f.expected.length,
    };
  });
  return {
    recall: totalExpected === 0 ? null : totalMatched / totalExpected,
    matched: totalMatched,
    expected: totalExpected,
    byFixture,
  };
}

/**
 * Minimum labels a bucket needs before its precision/FP is treated as
 * meaningful rather than noise. Buckets under this are flagged so a thin label
 * set can't silently drive threshold/rulepack decisions.
 */
export const MIN_LABELS_FOR_SIGNIFICANCE = 20;

export function labelSufficiencyWarnings(m: LabelMetrics): string[] {
  const warnings: string[] = [];
  if (m.overall.n < MIN_LABELS_FOR_SIGNIFICANCE) {
    warnings.push(
      `Only ${m.overall.n} labelled findings overall (< ${MIN_LABELS_FOR_SIGNIFICANCE}); metrics are directional, not statistically reliable.`,
    );
  }
  for (const [sev, b] of Object.entries(m.bySeverity)) {
    if (b.n > 0 && b.n < MIN_LABELS_FOR_SIGNIFICANCE) {
      warnings.push(`severity="${sev}": only ${b.n} labels — treat precision/FP as directional.`);
    }
  }
  return warnings;
}

export interface EvalReport {
  generatedAt: string;
  labels: LabelMetrics;
  recall: RecallResult;
  warnings: string[];
}

export interface Regression {
  scope: string; // e.g. "overall" | "severity:high" | "recall"
  metric: "precision" | "fpRate" | "recall";
  baseline: number;
  current: number;
  delta: number;
}

/**
 * Compare a report against a recorded baseline. A regression is precision or
 * recall dropping, or FP-rate rising, by more than `tolerance`. Buckets absent
 * from either side are skipped (can't compare what isn't there).
 */
export function diffAgainstBaseline(
  current: EvalReport,
  baseline: EvalReport,
  tolerance = 0.05,
): Regression[] {
  const regs: Regression[] = [];

  const cmp = (scope: string, metric: "precision" | "fpRate" | "recall", base: number | null, cur: number | null) => {
    if (base === null || cur === null) return;
    const worse = metric === "fpRate" ? cur - base : base - cur;
    if (worse > tolerance) {
      regs.push({ scope, metric, baseline: base, current: cur, delta: cur - base });
    }
  };

  cmp("overall", "precision", baseline.labels.overall.precision, current.labels.overall.precision);
  cmp("overall", "fpRate", baseline.labels.overall.fpRate, current.labels.overall.fpRate);
  for (const sev of Object.keys(current.labels.bySeverity)) {
    const b = baseline.labels.bySeverity[sev];
    const c = current.labels.bySeverity[sev];
    if (!b || !c) continue;
    cmp(`severity:${sev}`, "precision", b.precision, c.precision);
    cmp(`severity:${sev}`, "fpRate", b.fpRate, c.fpRate);
  }
  cmp("recall", "recall", baseline.recall.recall, current.recall.recall);

  return regs;
}
