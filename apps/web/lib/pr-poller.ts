import { prisma } from "@octopus/db";
import { getInstallationToken } from "@/lib/github";
import { startReviewFlow } from "@/lib/webhook-shared";

/**
 * Polling fallback for PR review triggering.
 *
 * Why this exists: Databricks Apps fronts every route with an OAuth proxy that
 * returns 401 for any anonymous request — so GitHub webhooks at
 * `/api/github/webhook` never reach the app (confirmed empirically; even
 * `/api/version` returns 401 externally). The webhook handler code is intact
 * but unreachable on this platform.
 *
 * As a workaround, on a fixed interval we:
 *   1. Enumerate Repository rows where `provider = 'github'` and
 *      `autoReview = true` and `indexStatus = 'indexed'`.
 *   2. For each repo, list open PRs via GitHub API (the App's installation
 *      token).
 *   3. For each PR, compare head_sha against any existing `PullRequest` row.
 *      If new SHA (or no row exists) → call `startReviewFlow`, which is the
 *      same entry point the webhook handler uses. It dedupes via headSha,
 *      so we never double-review.
 *
 * Cadence: 30s by default. Tunable via PR_POLL_INTERVAL_MS env var.
 */

const POLL_INTERVAL_MS = Number(process.env.PR_POLL_INTERVAL_MS ?? 30_000);
const GITHUB_API = "https://api.github.com";

let started = false;
let timer: NodeJS.Timeout | null = null;
let pollInFlight = false;

type GitHubPullSummary = {
  number: number;
  title: string;
  html_url: string;
  user?: { login?: string };
  head?: { sha?: string };
  draft?: boolean;
};

async function listOpenPullRequests(
  installationId: number,
  owner: string,
  repo: string,
): Promise<GitHubPullSummary[]> {
  const token = await getInstallationToken(installationId);
  // GitHub default is 30 results; bump to 100. Reviewing more than 100 open PRs
  // on a single repo via polling is unusual — accept truncation.
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls?state=open&per_page=100&sort=created&direction=desc`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );
  if (!res.ok) {
    throw new Error(`GitHub list PRs ${owner}/${repo} → ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as GitHubPullSummary[];
}

async function pollOnce(): Promise<void> {
  if (pollInFlight) {
    // Skip overlapping ticks if a previous poll is still running (slow GitHub
    // or a big repo set). Better to skip a tick than queue up multiple parallel
    // sweeps that compete for the same DB rows.
    return;
  }
  pollInFlight = true;
  const startedAt = Date.now();

  try {
    const repos = await prisma.repository.findMany({
      where: {
        provider: "github",
        isActive: true,
        autoReview: true,
        indexStatus: "indexed",
        installationId: { not: null },
      },
      select: {
        id: true,
        fullName: true,
        organizationId: true,
        installationId: true,
      },
    });

    if (repos.length === 0) return;

    let scannedPrs = 0;
    let triggered = 0;

    for (const repo of repos) {
      const [owner, repoName] = repo.fullName.split("/");
      if (!owner || !repoName || !repo.installationId) continue;

      let prs: GitHubPullSummary[];
      try {
        prs = await listOpenPullRequests(repo.installationId, owner, repoName);
      } catch (err) {
        console.warn(`[pr-poller] list-PRs failed for ${repo.fullName}:`, err instanceof Error ? err.message : err);
        continue;
      }

      for (const pr of prs) {
        if (!pr.head?.sha || !pr.number) continue;
        if (pr.draft) continue;
        scannedPrs++;

        const headSha = pr.head.sha;
        const existing = await prisma.pullRequest.findUnique({
          where: { repositoryId_number: { repositoryId: repo.id, number: pr.number } },
          select: { headSha: true, status: true, updatedAt: true },
        });

        // Skip if we've already kicked off a review for this exact SHA (and
        // it's not stuck — startReviewFlow has its own 3-minute-stuck rescue).
        if (existing && existing.headSha === headSha && existing.status !== "failed") {
          continue;
        }

        try {
          await startReviewFlow({
            provider: "github",
            installationId: repo.installationId,
            repoFullName: repo.fullName,
            repoId: repo.id,
            orgId: repo.organizationId,
            prNumber: pr.number,
            prTitle: pr.title,
            prUrl: pr.html_url,
            prAuthor: pr.user?.login ?? "unknown",
            headSha,
            triggerCommentId: 0,
            triggerCommentBody: "",
          });
          triggered++;
          console.log(`[pr-poller] triggered review for ${repo.fullName}#${pr.number} (sha=${headSha.slice(0, 8)})`);
        } catch (err) {
          console.error(`[pr-poller] startReviewFlow failed for ${repo.fullName}#${pr.number}:`, err);
        }
      }
    }

    if (scannedPrs > 0 || triggered > 0) {
      const ms = Date.now() - startedAt;
      console.log(`[pr-poller] swept ${repos.length} repos, ${scannedPrs} open PRs, ${triggered} new review(s) in ${ms}ms`);
    }
  } catch (err) {
    console.error("[pr-poller] tick failed:", err);
  } finally {
    pollInFlight = false;
  }
}

export function startPrPoller(): void {
  if (started) return;
  if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_APP_PRIVATE_KEY) {
    console.log("[pr-poller] GitHub App credentials missing — poller disabled");
    return;
  }
  started = true;
  console.log(`[pr-poller] starting (interval=${POLL_INTERVAL_MS}ms)`);

  // Fire once immediately so a freshly-deployed app picks up open PRs without
  // waiting for the first interval tick.
  pollOnce().catch((err) => console.error("[pr-poller] initial tick failed:", err));

  timer = setInterval(() => {
    pollOnce().catch((err) => console.error("[pr-poller] scheduled tick failed:", err));
  }, POLL_INTERVAL_MS);
  timer.unref?.();
}

export function stopPrPoller(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
