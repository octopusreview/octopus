/**
 * Heuristic diff classification + model tier resolution in front of
 * getReviewModel. Trivial/mechanical diffs (lockfile bumps, generated files,
 * docs/tests-only, tiny single-file edits) downshift to a cheaper model; the
 * default (Sonnet) is used for everything else. A deeper model for
 * complex/high-risk diffs is deferred to a plan-gated follow-up — this only ever
 * LOWERS cost, never risks quality by downshifting a substantive change.
 *
 * classifyDiff is pure/deterministic (unit-tested). resolveReviewModel keeps the
 * existing precedence (explicit override / repo pin / org pin win first) and is
 * self-protecting: it never emits a model that has no pricing (which would bill
 * $0), falling back to the default instead.
 */
import { prisma } from "@octopus/db";
import { getModelPricing } from "@/lib/cost";
import { getReviewModel } from "@/lib/ai-client";

/** Cheaper model for provably-mechanical diffs. Must exist in pricing (asserted in tests). */
export const MECHANICAL_MODEL = "claude-haiku-4-5-20251001";

export type DiffTier = "mechanical" | "standard" | "complex";

export interface DiffClass {
  loc: number;
  files: number;
  tier: DiffTier;
  mechanicalOnly: boolean;
  highRisk: boolean;
}

// Files whose changes are mechanical/generated — safe to review on a cheap model.
const MECHANICAL_FILE = [
  /(?:^|\/)(?:package-lock\.json|bun\.lock|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|composer\.lock|Gemfile\.lock|poetry\.lock)$/,
  /\.min\.(?:js|css)$/,
  /\.(?:snap|lock)$/,
  /(?:^|\/)(?:dist|build|vendor|generated)\//,
  /\.(?:md|mdx|txt|rst)$/, // docs
];
// Tests-only diffs are lower-risk (still real code, but not shipped behaviour).
const TEST_FILE = [/(?:^|\/)__tests__\//, /\.(?:test|spec)\.[cm]?[jt]sx?$/, /(?:^|\/)tests?\//];
// High-risk shared surfaces — mirror of touchesSharedFiles in the review paths.
const HIGH_RISK_FILE = [
  /(?:types|interfaces|schema|models)\//,
  /(?:utils|helpers|shared|common)\//,
  /(?:config|\.env|docker|ci)\b/,
  /\.d\.ts$/,
  /(?:prisma\/schema|migrations\/)/,
  /(?:package\.json|tsconfig)/,
];

const anyMatch = (patterns: RegExp[], s: string) => patterns.some((p) => p.test(s));

/** Extract changed file paths from a unified diff (`diff --git a/… b/…`). */
export function extractChangedPaths(diff: string): string[] {
  const paths: string[] = [];
  for (const m of diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) {
    paths.push(m[2]); // the "b/" (new) path
  }
  return paths;
}

export function classifyDiff(diff: string): DiffClass {
  const paths = extractChangedPaths(diff);
  const files = paths.length;

  // Changed lines of code = added/removed content lines, excluding the +++/---
  // file headers.
  let loc = 0;
  for (const line of diff.split("\n")) {
    if ((line.startsWith("+") && !line.startsWith("+++")) || (line.startsWith("-") && !line.startsWith("---"))) {
      loc++;
    }
  }

  const nonMechanical = paths.filter((p) => !anyMatch(MECHANICAL_FILE, p) && !anyMatch(TEST_FILE, p));
  // Mechanical only if every changed file is a lockfile/generated/docs/test file
  // (and at least one file changed).
  const mechanicalOnly = files > 0 && nonMechanical.length === 0;
  const highRisk = paths.some((p) => anyMatch(HIGH_RISK_FILE, p));

  let tier: DiffTier;
  if (mechanicalOnly) {
    // Lockfiles / generated / docs / tests are mechanical at any size.
    tier = "mechanical";
  } else if (highRisk || loc > 400 || files > 20) {
    tier = "complex";
  } else if (files <= 1 && loc <= 10) {
    tier = "mechanical";
  } else {
    tier = "standard";
  }

  return { loc, files, tier, mechanicalOnly, highRisk };
}

/**
 * Resolve the review model for a diff. Precedence (unchanged): explicit
 * modelOverride → repo pin → org pin → routed default. Only mechanical diffs are
 * downshifted, and only when the cheaper model actually has pricing.
 */
export async function resolveReviewModel(args: {
  orgId: string;
  repoId?: string;
  modelOverride?: string;
  diff: string;
}): Promise<string> {
  const { orgId, repoId, modelOverride, diff } = args;

  // Explicit pins always win — never override a user's deliberate model choice.
  if (modelOverride) return modelOverride;
  if (repoId) {
    const repo = await prisma.repository.findUnique({ where: { id: repoId }, select: { reviewModelId: true } });
    if (repo?.reviewModelId) return repo.reviewModelId;
  }
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { defaultModelId: true } });
  if (org?.defaultModelId) return org.defaultModelId;

  // No pin → routed default. getReviewModel returns the platform default here
  // (pins already handled above).
  const base = await getReviewModel(orgId, repoId);

  const cls = classifyDiff(diff);
  if (cls.tier === "mechanical" && MECHANICAL_MODEL !== base) {
    // Self-protect: never emit a model without pricing (would bill $0).
    const pricing = await getModelPricing().catch(() => null);
    if (pricing?.has(MECHANICAL_MODEL)) return MECHANICAL_MODEL;
  }
  return base;
}
