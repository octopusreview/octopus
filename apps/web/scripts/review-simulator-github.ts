/**
 * GitHub data fetching for the review lifecycle simulator.
 * Uses `gh api` CLI for authentication — no installation tokens needed.
 */

import { execSync } from "node:child_process";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PrMeta = {
  owner: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  baseSha: string;
  headSha: string;
  createdAt: string;
  state: string;
  url: string;
};

export type Commit = {
  sha: string;
  message: string;
  date: string;
};

export type IssueComment = {
  id: number;
  body: string;
  user: string;
  createdAt: string;
};

export type Review = {
  id: number;
  body: string;
  user: string;
  submittedAt: string;
  state: string;
  commitId: string;
};

export type ReviewComment = {
  id: number;
  path: string;
  line: number | null;
  body: string;
  user: string;
};

export type TriggerPoint = {
  index: number;
  type: "pr_opened" | "octopus_mention";
  sha: string;
  timestamp: string;
  commentBody?: string;
  userInstruction?: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ghApi(endpoint: string, headers?: Record<string, string>): string {
  const headerFlags = Object.entries(headers ?? {})
    .map(([k, v]) => `-H "${k}: ${v}"`)
    .join(" ");
  const cmd = `gh api ${headerFlags} "${endpoint}" --paginate 2>/dev/null`;
  try {
    return execSync(cmd, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return "[]";
  }
}

function ghApiJson<T>(endpoint: string): T {
  return JSON.parse(ghApi(endpoint)) as T;
}

// ─── Public Functions ────────────────────────────────────────────────────────

export function parsePrUrl(url: string): { owner: string; repo: string; number: number } {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) throw new Error(`Invalid PR URL: ${url}`);
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
}

export function fetchPrMeta(owner: string, repo: string, number: number): PrMeta {
  const pr = ghApiJson<{
    title: string;
    user: { login: string };
    base: { sha: string };
    head: { sha: string };
    created_at: string;
    state: string;
    html_url: string;
  }>(`repos/${owner}/${repo}/pulls/${number}`);

  return {
    owner,
    repo,
    number,
    title: pr.title,
    author: pr.user.login,
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
    createdAt: pr.created_at,
    state: pr.state,
    url: pr.html_url,
  };
}

export function fetchPrCommits(owner: string, repo: string, number: number): Commit[] {
  const commits = ghApiJson<{ sha: string; commit: { message: string; committer: { date: string } } }[]>(
    `repos/${owner}/${repo}/pulls/${number}/commits?per_page=100`,
  );
  return commits.map((c) => ({
    sha: c.sha,
    message: c.commit.message.split("\n")[0],
    date: c.commit.committer.date,
  }));
}

export function fetchIssueComments(owner: string, repo: string, number: number): IssueComment[] {
  const comments = ghApiJson<{ id: number; body: string; user: { login: string }; created_at: string }[]>(
    `repos/${owner}/${repo}/issues/${number}/comments?per_page=100`,
  );
  return comments.map((c) => ({
    id: c.id,
    body: c.body,
    user: c.user.login,
    createdAt: c.created_at,
  }));
}

export function fetchReviews(owner: string, repo: string, number: number): Review[] {
  const reviews = ghApiJson<{
    id: number;
    body: string;
    user: { login: string };
    submitted_at: string;
    state: string;
    commit_id: string;
  }[]>(`repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`);
  return reviews.map((r) => ({
    id: r.id,
    body: r.body,
    user: r.user.login,
    submittedAt: r.submitted_at,
    state: r.state,
    commitId: r.commit_id,
  }));
}

export function fetchReviewComments(owner: string, repo: string, number: number): ReviewComment[] {
  const comments = ghApiJson<{
    id: number;
    path: string;
    line: number | null;
    body: string;
    user: { login: string };
  }[]>(`repos/${owner}/${repo}/pulls/${number}/comments?per_page=100`);
  return comments.map((c) => ({
    id: c.id,
    path: c.path,
    line: c.line,
    body: c.body,
    user: c.user.login,
  }));
}

export function fetchDiffAtCommit(owner: string, repo: string, number: number): string {
  // Use the PR diff endpoint which gives the full PR diff
  const diff = ghApi(`repos/${owner}/${repo}/pulls/${number}`, {
    Accept: "application/vnd.github.v3.diff",
  });
  // Truncate to 100k chars like the review engine
  return diff.length > 100_000 ? diff.slice(0, 100_000) : diff;
}

/**
 * Build a timeline of trigger points from PR data.
 * Returns the PR open event + each @octopus mention.
 */
export function buildTimeline(
  meta: PrMeta,
  commits: Commit[],
  comments: IssueComment[],
  reviews: Review[],
): TriggerPoint[] {
  const triggers: TriggerPoint[] = [];

  // First trigger: PR opened
  const firstCommitSha = commits[0]?.sha ?? meta.headSha;
  triggers.push({
    index: 0,
    type: "pr_opened",
    sha: firstCommitSha,
    timestamp: meta.createdAt,
  });

  // Find @octopus mentions in issue comments
  const botNames = ["octopus-review[bot]", "octopus-review"];
  const octopusMentions = comments.filter(
    (c) => !botNames.includes(c.user) && /@octopus/i.test(c.body),
  );

  for (const mention of octopusMentions) {
    // Find the HEAD SHA at the time of this comment
    // Use the latest commit before or at this timestamp
    const commentTime = new Date(mention.createdAt).getTime();
    let sha = meta.headSha;
    for (const commit of commits) {
      if (new Date(commit.date).getTime() <= commentTime) {
        sha = commit.sha;
      }
    }

    // Extract user instruction from @octopus comment
    const instructionMatch = mention.body.match(/@octopus(?:-review)?\b\s*([\s\S]*)/i);
    const rawInstruction = instructionMatch?.[1]?.trim() ?? "";
    const userInstruction = rawInstruction.replace(/^review\b\s*/i, "").trim();

    triggers.push({
      index: triggers.length,
      type: "octopus_mention",
      sha,
      timestamp: mention.createdAt,
      commentBody: mention.body,
      userInstruction: userInstruction || undefined,
    });
  }

  return triggers;
}

/**
 * Get the actual bot reviews/findings at each trigger point.
 * Maps each trigger to the bot review that was posted around that time.
 */
export function matchReviewsToTriggers(
  triggers: TriggerPoint[],
  reviews: Review[],
): Map<number, Review> {
  const botReviews = reviews
    .filter((r) => r.user === "octopus-review[bot]" && r.body)
    .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());

  const matched = new Map<number, Review>();

  for (let i = 0; i < triggers.length; i++) {
    const trigger = triggers[i];
    const triggerTime = new Date(trigger.timestamp).getTime();
    const nextTriggerTime = i < triggers.length - 1
      ? new Date(triggers[i + 1].timestamp).getTime()
      : Infinity;

    // Find the bot review submitted after this trigger and before the next
    const review = botReviews.find((r) => {
      const reviewTime = new Date(r.submittedAt).getTime();
      return reviewTime >= triggerTime && reviewTime < nextTriggerTime;
    });

    if (review) {
      matched.set(i, review);
    }
  }

  return matched;
}
