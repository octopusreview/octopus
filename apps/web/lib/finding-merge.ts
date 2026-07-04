import { createHash } from "node:crypto";

/**
 * Compute a stable, content-derived signature for a finding.
 *
 * The signature is the prefix of a SHA-256 hash over a canonical
 * representation of the finding's identity:
 *   - filePath (exact, no normalisation)
 *   - category (case-insensitive, trimmed)
 *   - title (case-insensitive, trimmed, internal whitespace collapsed)
 *
 * Deliberately excluded:
 *   - severity, confidence, description, suggestion, line numbers — these
 *     can drift between runs for the same underlying issue without the
 *     finding being a different bug. Including them would defeat merging.
 *
 * 16 hex chars = 64 bits of entropy. At 1000 findings per PR the collision
 * probability is ~2.7e-14 — fine for this use case, and short enough to
 * eyeball in logs.
 */
export function findingSignature(input: {
  filePath: string;
  category: string;
  title: string;
}): string {
  const canonical = JSON.stringify({
    f: input.filePath,
    c: input.category.trim().toLowerCase(),
    t: input.title.trim().toLowerCase().replace(/\s+/g, " "),
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export type MergeResult<T> = {
  /** Findings to persist after merge — same length as `current`. */
  merged: T[];
  /** How many current findings inherited state from a prior finding. */
  inherited: number;
  /** How many current findings are new (no prior match). */
  added: number;
  /** Prior findings that no current finding matched (likely resolved). */
  obsoleted: number;
};

/**
 * Match current findings against prior findings by signature. For each match,
 * apply `inherit` to copy user-triage state (acknowledgement, feedback,
 * tracker IDs, original createdAt) from the prior finding onto the current one.
 *
 * Findings without signatures cannot participate in merging — they pass
 * through unchanged. Callers should compute signatures via {@link findingSignature}
 * before calling this.
 */
export function mergeFindingsBySignature<T extends { signature?: string | null }>(args: {
  prior: T[];
  current: T[];
  inherit: (next: T, prior: T) => T;
}): MergeResult<T> {
  const { prior, current, inherit } = args;

  const priorBySig = new Map<string, T>();
  for (const p of prior) {
    if (p.signature) priorBySig.set(p.signature, p);
  }

  const merged: T[] = [];
  const seenSigs = new Set<string>();
  let inherited = 0;

  for (const c of current) {
    if (c.signature && priorBySig.has(c.signature)) {
      merged.push(inherit(c, priorBySig.get(c.signature)!));
      seenSigs.add(c.signature);
      inherited += 1;
    } else {
      merged.push(c);
      if (c.signature) seenSigs.add(c.signature);
    }
  }

  let obsoleted = 0;
  for (const p of prior) {
    if (p.signature && !seenSigs.has(p.signature)) obsoleted += 1;
  }

  return {
    merged,
    inherited,
    added: merged.length - inherited,
    obsoleted,
  };
}

/**
 * The canonical triage-state inheritance used by every persistence path:
 * a signature-matched finding keeps the user's acknowledgement, feedback,
 * tracker links, posted-comment id, and original createdAt. Prior rows are
 * full DB records at runtime; keys are copied only when present, so this
 * satisfies the mergeFindingsBySignature contract ((next: T, prior: T) => T)
 * for any row shape.
 */
const TRIAGE_KEYS = [
  "acknowledgedAt",
  "feedback",
  "feedbackAt",
  "feedbackBy",
  "linearIssueId",
  "linearIssueUrl",
  "jiraIssueKey",
  "jiraIssueUrl",
  "githubIssueNumber",
  "githubIssueUrl",
  "githubCommentId",
  "createdAt",
] as const;

export function inheritReviewIssueTriage<T extends { signature?: string | null }>(
  next: T,
  prior: T,
): T {
  const out: Record<string, unknown> = { ...(next as Record<string, unknown>) };
  const p = prior as Record<string, unknown>;
  for (const key of TRIAGE_KEYS) {
    if (key in p) out[key] = p[key];
  }
  return out as T;
}
