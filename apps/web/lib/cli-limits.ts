/**
 * Shared limits between CLI-facing review endpoints. Keeping a single source
 * of truth here prevents the failure mode where the CLI truncates a diff to
 * one byte count and the server then rejects it because its own cap is
 * slightly smaller (eg. 500*1024 client vs 500_000 server). The CLI
 * mirrors `MAX_LOCAL_REVIEW_DIFF_BYTES` in its own constant since apps/cli
 * can't import from apps/web — drift between the two is a bug.
 */

/** Hard cap on the diff body accepted by /api/cli/review-local and
 *  /api/cli/repos/[id]/local-review. The CLI truncates above this size and
 *  emits a "diff truncated" warning; the server rejects anything larger
 *  with HTTP 413 as a defense-in-depth check. */
export const MAX_LOCAL_REVIEW_DIFF_BYTES = 500 * 1024;
