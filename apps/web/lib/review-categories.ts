/**
 * Canonical review-finding categories.
 * The values must match the strings the LLM emits in the `category` field
 * of each finding (see prompts/SYSTEM_PROMPT.md).
 */
export const REVIEW_CATEGORIES = [
  "Bug",
  "Security",
  "Performance",
  "Style",
  "Architecture",
  "Logic Error",
  "Race Condition",
] as const;

export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];

/**
 * Categories where false negatives are far more costly than false positives.
 * Findings in these categories get a lower confidence threshold so genuine
 * security/correctness issues are not silently dropped by validation.
 */
export const HIGH_RISK_CATEGORIES: ReadonlySet<string> = new Set<string>([
  "Bug",
  "Security",
  "Logic Error",
  "Race Condition",
]);

const HIGH_RISK_THRESHOLD_DELTA = 15;
const MIN_HIGH_RISK_THRESHOLD = 50;

/**
 * Per-category confidence threshold. High-risk categories get a relaxed
 * threshold (base - 15, floor 50) so security/bug findings survive validation.
 * Style/Performance/Architecture keep the base threshold.
 */
export function getCategoryConfidenceThreshold(
  category: string | undefined,
  baseThreshold: number,
): number {
  if (category && HIGH_RISK_CATEGORIES.has(category)) {
    return Math.max(MIN_HIGH_RISK_THRESHOLD, baseThreshold - HIGH_RISK_THRESHOLD_DELTA);
  }
  return baseThreshold;
}
