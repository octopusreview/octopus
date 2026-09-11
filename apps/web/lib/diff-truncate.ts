// Shared diff-size cap for the review engine, used by every provider path
// (GitHub, GitLab, Bitbucket) so the limit can't drift between them.
//
// Bounded changed-source allowance, separate from the provider's token context.
// 350k covers moderately large inputs that exceeded the former 300k ceiling.
// RAG, rulepacks and model output also consume context; characters are not a
// token guarantee. Env-tunable (MAX_DIFF_CHARS) for operator cost/context limits.
// The coverage manifest keeps oversized reviews explicitly incomplete.

export const MAX_DIFF_CHARS = (() => {
  const n = Number(process.env.MAX_DIFF_CHARS);
  return Number.isFinite(n) && n > 0 ? n : 350_000;
})();

// Raw-fetch ceiling — how much diff a provider fetch returns BEFORE generated/
// ignored files are filtered out. Must be well above MAX_DIFF_CHARS so a large
// generated file (e.g. a 12k-line ORM snapshot) doesn't crowd real files out of
// the fetch: it's fetched, then filtered, then the remainder is capped to
// MAX_DIFF_CHARS for review. Only genuinely enormous raw diffs hit this.
export const MAX_FETCH_DIFF_CHARS = (() => {
  const n = Number(process.env.MAX_FETCH_DIFF_CHARS);
  return Number.isFinite(n) && n > 0 ? n : 1_500_000;
})();

// Stable substring identifying a truncation notice (also used to build it).
export const TRUNCATION_MARKER = "[... diff truncated";

/** The factual truncation notice appended to a cut diff (no "split your PR" nag). */
export function truncationNotice(cap: number = MAX_DIFF_CHARS): string {
  return `\n\n${TRUNCATION_MARKER} at ${cap.toLocaleString("en-US")} chars — remaining files not included]`;
}

/** Cut a diff to `cap` with a truncation notice; leaves ≤cap diffs unchanged. */
export function truncateDiff(diff: string, cap: number = MAX_DIFF_CHARS): string {
  return diff.length > cap ? diff.slice(0, cap) + truncationNotice(cap) : diff;
}
