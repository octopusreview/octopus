import crypto from "node:crypto";

const GITHUB_API = "https://api.github.com";
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

async function fetchWithRetry(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, init);
    if (!RETRYABLE_STATUSES.has(res.status) || attempt === MAX_RETRIES) {
      return res;
    }
    const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
    console.warn(
      `[github] ${init?.method ?? "GET"} ${url} returned ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
    );
    await new Promise((r) => setTimeout(r, delay));
  }
  // unreachable, but satisfies TS
  throw new Error("Exceeded max retries");
}

function getPrivateKey(): string {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY!;
  // Support base64-encoded key (recommended for env vars)
  if (!raw.includes("-----BEGIN")) {
    return Buffer.from(raw, "base64").toString("utf-8");
  }
  return raw;
}

export function createAppJwt(): string {
  const appId = process.env.GITHUB_APP_ID!;
  const now = Math.floor(Date.now() / 1000);

  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");

  const payload = Buffer.from(
    JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId }),
  ).toString("base64url");

  const signature = crypto
    .createSign("RSA-SHA256")
    .update(`${header}.${payload}`)
    .sign(getPrivateKey(), "base64url");

  return `${header}.${payload}.${signature}`;
}

export async function getInstallationPermissions(
  installationId: number,
): Promise<Record<string, string>> {
  const jwt = createAppJwt();
  const res = await fetchWithRetry(
    `${GITHUB_API}/app/installations/${installationId}`,
    {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to get installation: ${res.status}`);
  }

  const data = await res.json();
  return (data.permissions ?? {}) as Record<string, string>;
}

export async function getInstallationToken(
  installationId: number,
): Promise<string> {
  const jwt = createAppJwt();
  const res = await fetchWithRetry(
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to get installation token: ${res.status}`);
  }

  const data = await res.json();
  return data.token as string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
}

export async function addCommentReaction(
  installationId: number,
  owner: string,
  repo: string,
  commentId: number,
  reaction: "+1" | "-1" | "laugh" | "confused" | "heart" | "hooray" | "rocket" | "eyes",
): Promise<void> {
  const token = await getInstallationToken(installationId);
  const res = await fetchWithRetry(
    `${GITHUB_API}/repos/${owner}/${repo}/issues/comments/${commentId}/reactions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({ content: reaction }),
    },
  );

  if (!res.ok) {
    console.error(`Failed to add reaction: ${res.status}`);
  }
}

export interface PullRequestDetails {
  number: number;
  title: string;
  url: string;
  author: string;
  headSha: string;
}

export async function getPullRequestDetails(
  installationId: number,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PullRequestDetails> {
  const token = await getInstallationToken(installationId);
  const res = await fetchWithRetry(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to get PR details: ${res.status}`);
  }

  const data = await res.json();
  return {
    number: data.number,
    title: data.title,
    url: data.html_url,
    author: data.user?.login ?? "unknown",
    headSha: data.head?.sha ?? "",
  };
}

export async function createCheckRun(
  installationId: number,
  owner: string,
  repo: string,
  headSha: string,
  name: string,
  detailsUrl?: string,
): Promise<number> {
  const token = await getInstallationToken(installationId);
  const res = await fetchWithRetry(
    `${GITHUB_API}/repos/${owner}/${repo}/check-runs`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({
        name,
        head_sha: headSha,
        status: "in_progress",
        started_at: new Date().toISOString(),
        ...(detailsUrl ? { details_url: detailsUrl } : {}),
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to create check run: ${res.status}`);
  }

  const data = await res.json();
  return data.id as number;
}

export async function updateCheckRun(
  installationId: number,
  owner: string,
  repo: string,
  checkRunId: number,
  conclusion: "success" | "failure" | "neutral",
  output: { title: string; summary: string },
): Promise<void> {
  const token = await getInstallationToken(installationId);
  const res = await fetchWithRetry(
    `${GITHUB_API}/repos/${owner}/${repo}/check-runs/${checkRunId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({
        status: "completed",
        conclusion,
        completed_at: new Date().toISOString(),
        output,
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to update check run: ${res.status}`);
  }
}

export type ReviewComment = {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
  start_line?: number;
};

export async function createPullRequestReview(
  installationId: number,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
  event: "COMMENT" | "REQUEST_CHANGES" | "APPROVE",
  comments: ReviewComment[],
): Promise<number> {
  const token = await getInstallationToken(installationId);
  const res = await fetchWithRetry(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({
        body,
        event,
        comments,
      }),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Failed to create PR review: ${res.status} ${errBody}`);
  }

  const data = await res.json();
  return data.id as number;
}

export async function getPullRequestDiff(
  installationId: number,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<string> {
  const token = await getInstallationToken(installationId);
  const res = await fetchWithRetry(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.diff",
      },
    },
  );

  if (res.ok) {
    const diff = await res.text();
    return truncateDiff(diff);
  }

  // GitHub returns 406 when the diff is too large (e.g. bulk file deletions).
  // Fall back to paginated /files endpoint to reconstruct the diff.
  if (res.status === 406) {
    console.warn(
      `[github] Diff too large for ${owner}/${repo}#${prNumber}, falling back to /files endpoint`,
    );
    return await getPullRequestDiffViaFiles(token, owner, repo, prNumber);
  }

  throw new Error(`Failed to get PR diff: ${res.status}`);
}

const MAX_DIFF_CHARS = 30_000;

function truncateDiff(diff: string): string {
  return diff.length > MAX_DIFF_CHARS
    ? diff.slice(0, MAX_DIFF_CHARS) + "\n\n[... diff truncated at 30,000 chars]"
    : diff;
}

async function getPullRequestDiffViaFiles(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<string> {
  const patches: string[] = [];
  let totalLength = 0;
  let page = 1;

  while (totalLength < MAX_DIFF_CHARS) {
    const res = await fetchWithRetry(
      `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      },
    );

    if (!res.ok) {
      throw new Error(`Failed to get PR files: ${res.status}`);
    }

    const files: Array<{ filename: string; status: string; patch?: string }> =
      await res.json();

    if (files.length === 0) break;

    for (const file of files) {
      const header = `diff --git a/${file.filename} b/${file.filename}\n--- a/${file.filename}\n+++ b/${file.filename}\n`;
      const patch = file.patch ?? "(binary or too large)";
      const entry = header + patch + "\n";

      patches.push(entry);
      totalLength += entry.length;

      if (totalLength >= MAX_DIFF_CHARS) break;
    }

    if (files.length < 100) break;
    page++;
  }

  return truncateDiff(patches.join(""));
}

export async function createPullRequestComment(
  installationId: number,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<number> {
  const token = await getInstallationToken(installationId);
  const res = await fetchWithRetry(
    `${GITHUB_API}/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({ body }),
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to create PR comment: ${res.status}`);
  }

  const data = await res.json();
  return data.id as number;
}

export async function updatePullRequestComment(
  installationId: number,
  owner: string,
  repo: string,
  commentId: number,
  body: string,
): Promise<void> {
  const token = await getInstallationToken(installationId);
  const res = await fetchWithRetry(
    `${GITHUB_API}/repos/${owner}/${repo}/issues/comments/${commentId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({ body }),
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to update PR comment: ${res.status}`);
  }
}

export async function createGitHubIssue(
  installationId: number,
  owner: string,
  repo: string,
  title: string,
  body: string,
  labels?: string[],
): Promise<{ number: number; html_url: string }> {
  const token = await getInstallationToken(installationId);
  const res = await fetchWithRetry(
    `${GITHUB_API}/repos/${owner}/${repo}/issues`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({ title, body, labels }),
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    if (res.status === 404) {
      throw new Error(
        "GitHub App does not have permission to create issues. Please update the app's permissions: Settings → Developer settings → GitHub Apps → Permissions → Issues → Read & write.",
      );
    }
    throw new Error(`Failed to create GitHub issue: ${res.status} ${errBody}`);
  }

  const data = await res.json();
  return { number: data.number, html_url: data.html_url };
}

export type IssueReactions = {
  thumbsUp: number;
  thumbsDown: number;
  total: number;
};

export async function getIssueReactions(
  installationId: number,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<IssueReactions> {
  const token = await getInstallationToken(installationId);
  const res = await fetchWithRetry(
    `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/reactions`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (!res.ok) {
    console.error(`[github] Failed to fetch issue reactions: ${res.status}`);
    return { thumbsUp: 0, thumbsDown: 0, total: 0 };
  }

  const reactions = (await res.json()) as { content: string }[];
  let thumbsUp = 0;
  let thumbsDown = 0;
  for (const r of reactions) {
    if (r.content === "+1") thumbsUp++;
    if (r.content === "-1") thumbsDown++;
  }

  return { thumbsUp, thumbsDown, total: reactions.length };
}

export type ReviewCommentWithReactions = {
  id: number;
  path: string;
  line: number | null;
  body: string;
  thumbsUp: number;
  thumbsDown: number;
};

export async function listPullRequestReviews(
  installationId: number,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ id: number; body: string; user: string; submittedAt: string }[]> {
  const token = await getInstallationToken(installationId);
  const res = await fetchWithRetry(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (!res.ok) {
    console.error(`[github] Failed to list PR reviews: ${res.status}`);
    return [];
  }

  const reviews = (await res.json()) as { id: number; body: string; user: { login: string }; submitted_at: string }[];
  return reviews.map((r) => ({
    id: r.id,
    body: r.body,
    user: r.user.login,
    submittedAt: r.submitted_at,
  }));
}

export async function listReviewComments(
  installationId: number,
  owner: string,
  repo: string,
  prNumber: number,
  reviewId: number,
): Promise<ReviewCommentWithReactions[]> {
  const token = await getInstallationToken(installationId);
  const res = await fetchWithRetry(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}/reviews/${reviewId}/comments?per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (!res.ok) {
    console.error(`[github] Failed to list review comments: ${res.status}`);
    return [];
  }

  const comments = (await res.json()) as {
    id: number;
    path: string;
    line: number | null;
    original_line: number | null;
    body: string;
    reactions: { "+1": number; "-1": number };
  }[];

  return comments.map((c) => ({
    id: c.id,
    path: c.path,
    line: c.line ?? c.original_line,
    body: c.body,
    thumbsUp: c.reactions["+1"] ?? 0,
    thumbsDown: c.reactions["-1"] ?? 0,
  }));
}

export type PRReviewComment = {
  id: number;
  path: string;
  line: number | null;
  body: string;
  user: string;
  inReplyToId: number | null;
  isOutdated: boolean;
};

export async function listPullRequestReviewComments(
  installationId: number,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PRReviewComment[]> {
  const token = await getInstallationToken(installationId);
  const res = await fetchWithRetry(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (!res.ok) {
    console.error(`[github] Failed to list PR review comments: ${res.status}`);
    return [];
  }

  const comments = (await res.json()) as {
    id: number;
    path: string;
    line: number | null;
    original_line: number | null;
    position: number | null;
    body: string;
    user: { login: string } | null;
    in_reply_to_id?: number;
  }[];

  return comments.map((c) => ({
    id: c.id,
    path: c.path,
    line: c.line ?? c.original_line,
    body: c.body,
    user: c.user?.login ?? "",
    inReplyToId: c.in_reply_to_id ?? null,
    isOutdated: c.line === null && c.original_line !== null,
  }));
}

/**
 * List issue comments (general PR comments, NOT inline review comments).
 * These are the comments posted via issues/{number}/comments endpoint.
 */
export async function listPullRequestIssueComments(
  installationId: number,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ id: number; body: string; createdAt: string; user: string }[]> {
  const token = await getInstallationToken(installationId);
  const res = await fetchWithRetry(
    `${GITHUB_API}/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (!res.ok) {
    console.error(`[github] Failed to list PR issue comments: ${res.status}`);
    return [];
  }

  const comments = (await res.json()) as { id: number; body: string; created_at: string; user: { login: string } }[];
  return comments.map((c) => ({
    id: c.id,
    body: c.body,
    createdAt: c.created_at,
    user: c.user.login,
  }));
}

export async function getCommentReactions(
  installationId: number,
  owner: string,
  repo: string,
  commentId: number,
): Promise<{ thumbsUp: number; thumbsDown: number }> {
  const token = await getInstallationToken(installationId);
  const res = await fetchWithRetry(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls/comments/${commentId}/reactions`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (!res.ok) {
    console.error(`[github] Failed to fetch comment reactions: ${res.status}`);
    return { thumbsUp: 0, thumbsDown: 0 };
  }

  const reactions = (await res.json()) as { content: string }[];
  let thumbsUp = 0;
  let thumbsDown = 0;
  for (const r of reactions) {
    if (r.content === "+1") thumbsUp++;
    if (r.content === "-1") thumbsDown++;
  }
  return { thumbsUp, thumbsDown };
}

/**
 * Fetch a single repository's metadata. Returns null on 404 (repo missing or
 * installation has no access). The `installation_repositories` webhook payload
 * does not include `default_branch`, so this is used to resolve it correctly.
 */
export async function getRepositoryDetails(
  installationId: number,
  owner: string,
  repo: string,
  providedToken?: string,
): Promise<GitHubRepo | null> {
  const token = providedToken ?? await getInstallationToken(installationId);
  const res = await fetchWithRetry(
    `${GITHUB_API}/repos/${owner}/${repo}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to get repo details: ${res.status}`);
  }

  const data = await res.json();
  return {
    id: data.id,
    name: data.name,
    full_name: data.full_name,
    private: data.private,
    default_branch: data.default_branch,
    html_url: data.html_url,
  };
}

export async function listInstallationRepos(
  installationId: number,
): Promise<GitHubRepo[]> {
  const token = await getInstallationToken(installationId);
  const repos: GitHubRepo[] = [];
  let page = 1;

  while (true) {
    const res = await fetchWithRetry(
      `${GITHUB_API}/installation/repositories?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      },
    );

    if (!res.ok) {
      throw new Error(`Failed to list repos: ${res.status}`);
    }

    const data = await res.json();
    repos.push(...data.repositories);

    if (data.repositories.length < 100) break;
    page++;
  }

  return repos;
}

/** Fetch the full file tree of a repository (recursive, blob paths only). */
export async function getRepositoryTree(
  installationId: number,
  owner: string,
  repo: string,
  branch: string,
  /** Pre-resolved token. Skips getInstallationToken when provided. */
  providedToken?: string,
): Promise<string[]> {
  const token = providedToken ?? await getInstallationToken(installationId);
  const res = await fetchWithRetry(
    `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (!res.ok) {
    console.error(`[github] Failed to fetch tree: ${res.status}`);
    return [];
  }

  const data = await res.json();
  return (data.tree as { path: string; type: string }[])
    .filter((item) => item.type === "blob")
    .map((item) => item.path);
}

export async function getFileContent(
  installationId: number,
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
  /** Pre-resolved token. Skips getInstallationToken when provided. */
  providedToken?: string,
): Promise<string | null> {
  const token = providedToken ?? await getInstallationToken(installationId);
  const res = await fetchWithRetry(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(branch)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.raw+json",
      },
    },
  );

  if (!res.ok) return null;
  return res.text();
}
