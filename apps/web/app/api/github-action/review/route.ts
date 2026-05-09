import { authenticateApiToken } from "@/lib/api-auth";
import { prisma } from "@octopus/db";
import { generateLocalReview } from "@/lib/review-core";
import { isOrgOverSpendLimit } from "@/lib/cost";
import { ORG_TYPE } from "@/lib/org-types";
import { getRepositoryTree } from "@/lib/github";
import { eventBus } from "@/lib/events/bus";
import { enqueue } from "@/lib/queue";
import { persistCommunityReviewToPR } from "@/lib/community-pr-persist";
import { NextRequest } from "next/server";

const GITHUB_API = "https://api.github.com";
const COMMUNITY_JOB_TTL_HOURS = 25;

const LOG = (msg: string, ...rest: unknown[]) =>
  console.log(`[github-action] ${msg}`, ...rest);
const ERR = (msg: string, ...rest: unknown[]) =>
  console.error(`[github-action] ${msg}`, ...rest);

// ─── Community org helpers ──────────────────────────────────────────────────

async function fetchGitHubRepoInfo(
  githubToken: string,
  owner: string,
  repo: string,
): Promise<{ id: number; defaultBranch: string; isPrivate: boolean; fullName: string } | null> {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return {
    id: data.id,
    defaultBranch: data.default_branch,
    isPrivate: data.private,
    fullName: data.full_name,
  };
}

async function getOrCreateCommunityOrg(githubOwner: string) {
  const slug = `community-${githubOwner.toLowerCase()}`;
  return prisma.organization.upsert({
    where: { slug },
    create: {
      name: `${githubOwner} (Community)`,
      slug,
      type: ORG_TYPE.COMMUNITY,
      freeCreditBalance: 0,
    },
    update: { type: ORG_TYPE.COMMUNITY },
  });
}

async function getCommunityReviewCountToday(orgId: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return prisma.aiUsage.count({
    where: {
      organizationId: orgId,
      operation: "community-review",
      createdAt: { gte: startOfDay },
    },
  });
}

// ─── Main handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Validate action secret (when configured)
  const actionSecret = process.env.OCTOPUS_ACTION_SECRET;
  if (actionSecret) {
    const headerSecret = request.headers.get("x-octopus-action-secret");
    if (!headerSecret || headerSecret !== actionSecret) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    owner,
    repo: repoName,
    prNumber,
    prTitle,
    prAuthor,
    headSha,
    baseBranch,
    diff,
    githubToken,
    forceReindex,
    reindexThresholdHours,
  } = body as {
    owner?: string;
    repo?: string;
    prNumber?: number;
    prTitle?: string;
    prAuthor?: string;
    headSha?: string;
    baseBranch?: string;
    diff?: string;
    githubToken?: string;
    forceReindex?: boolean;
    reindexThresholdHours?: number;
  };

  if (!owner || !repoName || !diff || !githubToken) {
    return Response.json(
      { error: "Missing required fields: owner, repo, diff, githubToken" },
      { status: 400 },
    );
  }

  if (typeof diff !== "string" || diff.length > 500_000) {
    return Response.json({ error: "Diff too large (max 500KB)" }, { status: 413 });
  }

  // ── Dual auth ─────────────────────────────────────────────────────────────

  const apiAuth = await authenticateApiToken(request);
  const hasAuthHeader = request.headers.get("authorization")?.startsWith("Bearer ") ?? false;
  let orgId: string;
  let isCommunityMode = false;
  let communityDailyLimit = 5;

  if (apiAuth) {
    orgId = apiAuth.org.id;
  } else if (hasAuthHeader) {
    return Response.json(
      { error: "Invalid or expired octopus-api-key" },
      { status: 401 },
    );
  } else {
    const repoInfo = await fetchGitHubRepoInfo(githubToken, owner, repoName);
    if (!repoInfo) {
      return Response.json(
        { error: "Failed to fetch repository info. Check that the GitHub token is valid." },
        { status: 401 },
      );
    }
    if (repoInfo.isPrivate) {
      return Response.json(
        { error: "Private repos require octopus-api-key" },
        { status: 401 },
      );
    }
    const communityOrg = await getOrCreateCommunityOrg(owner);
    orgId = communityOrg.id;
    communityDailyLimit = communityOrg.communityDailyReviewLimit;
    isCommunityMode = true;
  }

  // ── Fetch repo info from GitHub ───────────────────────────────────────────

  const ghRepoInfo = await fetchGitHubRepoInfo(githubToken, owner, repoName);
  if (!ghRepoInfo) {
    return Response.json({ error: "Repository not found on GitHub" }, { status: 404 });
  }

  // ── Find or create repository ─────────────────────────────────────────────

  const fullName = `${owner}/${repoName}`;
  const externalId = String(ghRepoInfo.id);

  const repo = await prisma.repository.upsert({
    where: {
      provider_externalId_organizationId: { provider: "github", externalId, organizationId: orgId },
    },
    create: {
      name: repoName,
      fullName,
      provider: "github",
      externalId,
      defaultBranch: ghRepoInfo.defaultBranch,
      organizationId: orgId,
      isActive: true,
    },
    update: {
      defaultBranch: ghRepoInfo.defaultBranch,
    },
  });

  // ── Community rate limit ─────────────────────────────────────────────────

  if (isCommunityMode) {
    const todayCount = await getCommunityReviewCountToday(orgId);
    if (todayCount >= communityDailyLimit) {
      return Response.json(
        { error: "Daily review limit reached (community tier). Add octopus-api-key for unlimited reviews." },
        { status: 429 },
      );
    }
  }

  if (!isCommunityMode && (await isOrgOverSpendLimit(orgId))) {
    return Response.json({ error: "Monthly spend limit reached" }, { status: 402 });
  }

  // ── Decide flow: queued (community + not indexed) vs sync ────────────────

  const thresholdHours = reindexThresholdHours ?? 24;
  const stale =
    repo.indexedAt != null &&
    Date.now() - repo.indexedAt.getTime() > thresholdHours * 60 * 60 * 1000;
  const needsIndex = repo.indexStatus !== "indexed" || forceReindex === true || stale;

  // For community mode without an existing index → enqueue + poll.
  // Authenticated orgs keep the legacy sync flow (they can have higher CF
  // timeouts or the action runs internally), and indexed community repos are
  // fast enough to stay sync.
  if (isCommunityMode && needsIndex) {
    return await enqueueCommunityReview({
      repo,
      orgId,
      fullName,
      prNumber,
      prTitle,
      prAuthor,
      headSha,
      baseBranch,
      diff,
      githubToken,
    });
  }

  // ── Sync flow (indexed already, or paid org) ─────────────────────────────

  let indexed = false;
  if (needsIndex) {
    LOG(`[sync] indexing ${fullName} inline (paid org)`);
    // Paid org sync indexing — keep legacy behavior since they're not on the
    // public Cloudflare 100s timeout path.
    try {
      const { indexRepository } = await import("@/lib/indexer");
      const { summarizeRepository } = await import("@/lib/summarizer");
      const { analyzeRepository } = await import("@/lib/analyzer");

      await prisma.repository.update({
        where: { id: repo.id },
        data: { indexStatus: "indexing" },
      });

      const indexStats = await indexRepository(
        repo.id,
        fullName,
        ghRepoInfo.defaultBranch,
        0,
        () => {},
        undefined,
        "github",
        orgId,
        githubToken,
      );

      await prisma.repository.update({
        where: { id: repo.id },
        data: {
          indexStatus: "indexed",
          indexedAt: new Date(),
          indexedFiles: indexStats.indexedFiles,
          totalFiles: indexStats.totalFiles,
          totalChunks: indexStats.totalChunks,
          totalVectors: indexStats.totalVectors,
          indexDurationMs: indexStats.durationMs,
          contributorCount: indexStats.contributorCount,
          contributors: JSON.parse(JSON.stringify(indexStats.contributors)),
          ...(indexStats.resolvedDefaultBranch ? { defaultBranch: indexStats.resolvedDefaultBranch } : {}),
        },
      });

      try {
        const { summary, purpose } = await summarizeRepository(repo.id, fullName, orgId);
        await prisma.repository.update({ where: { id: repo.id }, data: { summary, purpose } });
      } catch (err) {
        ERR("summarize failed:", err);
      }
      try {
        const analysis = await analyzeRepository(repo.id, fullName, orgId);
        await prisma.repository.update({
          where: { id: repo.id },
          data: { analysis, analysisStatus: "analyzed", analyzedAt: new Date() },
        });
        eventBus.emit({ type: "repo-analyzed", orgId, repoFullName: fullName });
      } catch (err) {
        ERR("analyze failed:", err);
      }
      indexed = true;
    } catch (err) {
      ERR("inline indexing failed:", err);
      await prisma.repository.update({ where: { id: repo.id }, data: { indexStatus: "failed" } });
    }
  }

  let fileTree: string[] | undefined;
  try {
    const [ownerPart, repoPart] = fullName.split("/");
    fileTree = await getRepositoryTree(0, ownerPart, repoPart, ghRepoInfo.defaultBranch, githubToken);
  } catch {
    // ignore
  }

  try {
    const reviewResult = await generateLocalReview({
      diff,
      repoId: repo.id,
      orgId,
      title: typeof prTitle === "string" ? prTitle : undefined,
      author: typeof prAuthor === "string" ? prAuthor : undefined,
      fileTree,
      operation: isCommunityMode ? "community-review" : "local-review",
      prNumber: typeof prNumber === "number" ? prNumber : undefined,
    });

    let firstCommunityReview = false;
    if (isCommunityMode) {
      const existingPRCount = await prisma.pullRequest.count({ where: { repositoryId: repo.id } });
      firstCommunityReview = existingPRCount === 0;

      if (typeof prNumber === "number") {
        try {
          await persistCommunityReviewToPR({
            repositoryId: repo.id,
            fullName,
            prNumber,
            prTitle: typeof prTitle === "string" ? prTitle : null,
            prAuthor: typeof prAuthor === "string" ? prAuthor : null,
            headSha: typeof headSha === "string" ? headSha : null,
            summary: reviewResult.summary,
            findings: reviewResult.findings,
          });
        } catch (persistErr) {
          ERR("persist community PR failed (non-fatal):", persistErr);
        }
      }

      eventBus.emit({
        type: "community-review",
        orgId,
        repoFullName: fullName,
        prNumber: typeof prNumber === "number" ? prNumber : undefined,
        findingsCount: reviewResult.findings.length,
      });
    }

    return Response.json({
      status: "completed",
      findings: reviewResult.findings,
      summary: reviewResult.summary,
      model: reviewResult.model,
      indexed,
      community: isCommunityMode,
      firstCommunityReview,
      usage: reviewResult.usage,
    });
  } catch (err) {
    ERR("review generation failed:", err);
    return Response.json({ error: "Review generation failed" }, { status: 500 });
  }
}

// ─── Queued path helpers ────────────────────────────────────────────────────

async function enqueueCommunityReview(params: {
  repo: { id: string; defaultBranch: string };
  orgId: string;
  fullName: string;
  prNumber?: number;
  prTitle?: string;
  prAuthor?: string;
  headSha?: string;
  baseBranch?: string;
  diff: string;
  githubToken: string;
}) {
  const {
    repo,
    orgId,
    fullName,
    prNumber,
    prTitle,
    prAuthor,
    headSha,
    baseBranch,
    diff,
    githubToken,
  } = params;

  // De-dupe: same repo + PR + headSha already in flight → return existing job.
  if (typeof prNumber === "number" && headSha) {
    const existing = await prisma.communityReviewJob.findFirst({
      where: {
        repositoryId: repo.id,
        prNumber,
        headSha,
        status: { in: ["indexing", "reviewing"] },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      LOG(`[queue] dedup hit jobId=${existing.id} repo=${fullName} PR=${prNumber}`);
      return Response.json({
        status: "queued",
        jobId: existing.id,
        existing: true,
        community: true,
        message: "Review is already queued for this PR + commit. Poll the job to get the result.",
      });
    }
  }

  const expiresAt = new Date(Date.now() + COMMUNITY_JOB_TTL_HOURS * 60 * 60 * 1000);

  const job = await prisma.communityReviewJob.create({
    data: {
      status: "indexing",
      repoFullName: fullName,
      repositoryId: repo.id,
      organizationId: orgId,
      prNumber: prNumber ?? null,
      prTitle: prTitle ?? null,
      prAuthor: prAuthor ?? null,
      headSha: headSha ?? null,
      baseBranch: baseBranch ?? null,
      diff,
      githubToken,
      expiresAt,
    },
  });

  LOG(`[queue] created jobId=${job.id} repo=${fullName} PR=${prNumber ?? "?"} sha=${headSha ?? "?"}`);

  await prisma.auditLog.create({
    data: {
      action: "community_review.queued",
      category: "review",
      targetType: "community_review_job",
      targetId: job.id,
      organizationId: orgId,
      metadata: {
        repoFullName: fullName,
        prNumber: prNumber ?? null,
        headSha: headSha ?? null,
        diffSize: diff.length,
      },
    },
  }).catch((err) => ERR("audit log create failed (non-fatal):", err));

  await enqueue("community-review", { jobId: job.id });

  return Response.json({
    status: "queued",
    jobId: job.id,
    existing: false,
    community: true,
    message: "Repository is not indexed yet. Indexing in background; poll the job for results.",
  });
}
