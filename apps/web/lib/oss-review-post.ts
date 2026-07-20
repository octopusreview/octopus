/**
 * Posts a review to a public PR as a shared GitHub bot user account (bot_account mode).
 *
 * This is the server-side counterpart to the GitHub Action's client-side posting.
 * The review is submitted with the bot account's own token (OCTOPUS_BOT_GITHUB_TOKEN),
 * NOT the repo's GITHUB_TOKEN. A bot account that is not a collaborator on the repo can
 * only submit review comments — GitHub blocks everything else (labels, status, merge,
 * check runs), which is exactly the comment-only guarantee we want for OSS repos that
 * are unwilling to grant write access in their CI.
 */

import { createPullRequestReview, type ReviewComment } from "@/lib/github";
import { parseDiffLines, buildInlineComments } from "@/lib/review-helpers";
import type { InlineFinding } from "@/lib/review-dedup";

const LOG = (msg: string, ...rest: unknown[]) =>
  console.log(`[oss-review-post] ${msg}`, ...rest);

export interface PostOssReviewParams {
  owner: string;
  repo: string;
  prNumber: number;
  findings: InlineFinding[];
  diff: string;
  summary: string;
  /** Bot account token (OCTOPUS_BOT_GITHUB_TOKEN). */
  botToken: string;
}

export interface PostOssReviewResult {
  posted: number;
  skipped: number;
}

/**
 * Submit the review as a single COMMENT-event review (summary body + inline comments).
 * Mirrors the Action's 422-resilience: if GitHub rejects an inline comment (usually an
 * unmappable line), retry once without inline comments so the summary still lands.
 */
export async function postOssReview(params: PostOssReviewParams): Promise<PostOssReviewResult> {
  const { owner, repo, prNumber, findings, diff, summary, botToken } = params;

  const diffLines = parseDiffLines(diff);
  const comments: ReviewComment[] = buildInlineComments(findings, diffLines, "github");

  const body =
    (summary && summary.trim().length > 0 ? summary : "No issues found. Looking good!") +
    "\n\n---\n*Reviewed by [Octopus](https://octopus-review.ai)*";

  try {
    await createPullRequestReview(0, owner, repo, prNumber, body, "COMMENT", comments, botToken);
    LOG(`posted review on ${owner}/${repo}#${prNumber}: ${comments.length} inline comments`);
    return { posted: comments.length, skipped: findings.length - comments.length };
  } catch (err) {
    const ghErr = err as { message?: string };
    const is422 = typeof ghErr.message === "string" && ghErr.message.includes("422");
    if (is422 && comments.length > 0) {
      // A comment line couldn't be mapped to the diff — post the summary alone.
      LOG(`422 with ${comments.length} inline comments on ${owner}/${repo}#${prNumber}, retrying summary-only`);
      await createPullRequestReview(0, owner, repo, prNumber, body, "COMMENT", [], botToken);
      return { posted: 0, skipped: findings.length };
    }
    throw err;
  }
}
