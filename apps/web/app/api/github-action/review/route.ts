import { authenticateApiToken } from "@/lib/api-auth";
import { prisma } from "@octopus/db";
import { generateLocalReview } from "@/lib/review-core";
import { isOrgOverSpendLimit } from "@/lib/cost";
import { indexRepository } from "@/lib/indexer";
import { summarizeRepository } from "@/lib/summarizer";
import { analyzeRepository } from "@/lib/analyzer";
import { getRepositoryTree } from "@/lib/github";
import { eventBus } from "@/lib/events/bus";
import { NextRequest } from "next/server";

const GITHUB_API = "https://api.github.com";

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
      type: 2, // community
      freeCreditBalance: 0,
    },
    update: {},
  });
}

async function getCommunityReviewCountToday(orgId: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return prisma.aiUsage.count({
    where: {
      organizationId: orgId,
      operation: "review",
      createdAt: { gte: startOfDay },
    },
  });
}

// ─── Main handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
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

  // Validate required fields
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
  let orgId: string;
  let isCommunityMode = false;
  let communityDailyLimit = 5;

  if (apiAuth) {
    // Mode 1: API key present → use real org
    orgId = apiAuth.org.id;
  } else {
    // Mode 2: No API key → community mode (public repos only)
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
      provider_externalId: { provider: "github", externalId },
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

  // ── Community rate limit ──────────────────────────────────────────────────

  if (isCommunityMode) {
    const todayCount = await getCommunityReviewCountToday(orgId);
    if (todayCount >= communityDailyLimit) {
      return Response.json(
        { error: "Daily review limit reached (community tier). Add octopus-api-key for unlimited reviews." },
        { status: 429 },
      );
    }
  }

  // ── Spend limit (for authenticated orgs) ──────────────────────────────────

  if (!isCommunityMode && await isOrgOverSpendLimit(orgId)) {
    return Response.json({ error: "Monthly spend limit reached" }, { status: 402 });
  }

  // ── Indexing ──────────────────────────────────────────────────────────────

  let indexed = false;
  const thresholdHours = reindexThresholdHours ?? 24;
  const needsIndex =
    repo.indexStatus !== "indexed" ||
    forceReindex ||
    (repo.indexedAt && Date.now() - repo.indexedAt.getTime() > thresholdHours * 60 * 60 * 1000);

  if (needsIndex) {
    try {
      console.log(`[github-action] Indexing ${fullName}...`);

      await prisma.repository.update({
        where: { id: repo.id },
        data: { indexStatus: "indexing" },
      });

      const indexStats = await indexRepository(
        repo.id,
        fullName,
        ghRepoInfo.defaultBranch,
        0, // installationId not needed — using providedToken
        () => {}, // onLog
        undefined, // signal
        "github",
        orgId,
        githubToken, // providedToken
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
        },
      });

      console.log(`[github-action] Indexing complete: ${indexStats.indexedFiles} files, ${indexStats.totalVectors} vectors`);

      // Summarize & analyze (best-effort, don't fail review if these fail)
      try {
        const { summary, purpose } = await summarizeRepository(repo.id, fullName, orgId);
        await prisma.repository.update({
          where: { id: repo.id },
          data: { summary, purpose },
        });
      } catch (err) {
        console.error("[github-action] Summarize failed:", err);
      }

      try {
        const analysis = await analyzeRepository(repo.id, fullName, orgId);
        await prisma.repository.update({
          where: { id: repo.id },
          data: { analysis, analysisStatus: "analyzed", analyzedAt: new Date() },
        });
      } catch (err) {
        console.error("[github-action] Analyze failed:", err);
      }

      indexed = true;
    } catch (err) {
      console.error("[github-action] Indexing failed:", err);
      await prisma.repository.update({
        where: { id: repo.id },
        data: { indexStatus: "failed" },
      });
      // Continue with review even if indexing failed — generateLocalReview works without index
    }
  }

  // ── Fetch file tree ───────────────────────────────────────────────────────

  const [ownerPart, repoPart] = fullName.split("/");
  let fileTree: string[] | undefined;
  try {
    fileTree = await getRepositoryTree(
      0, // installationId not needed
      ownerPart,
      repoPart,
      ghRepoInfo.defaultBranch,
      githubToken,
    );
  } catch {
    console.warn("[github-action] Failed to fetch file tree, continuing without it");
  }

  // ── Generate review ───────────────────────────────────────────────────────

  try {
    const reviewResult = await generateLocalReview({
      diff,
      repoId: repo.id,
      orgId: orgId,
      title: typeof prTitle === "string" ? prTitle : undefined,
      author: typeof prAuthor === "string" ? prAuthor : undefined,
      fileTree,
    });

    // Check if this is the first community review for this repo
    let firstCommunityReview = false;
    if (isCommunityMode) {
      const existingPRCount = await prisma.pullRequest.count({
        where: { repositoryId: repo.id },
      });
      firstCommunityReview = existingPRCount === 0;

      eventBus.emit({
        type: "community-review",
        orgId,
        repoFullName: fullName,
        prNumber: typeof prNumber === "number" ? prNumber : undefined,
        findingsCount: reviewResult.findings.length,
      });
    }

    return Response.json({
      findings: reviewResult.findings,
      summary: reviewResult.summary,
      model: reviewResult.model,
      indexed,
      community: isCommunityMode,
      firstCommunityReview,
      usage: reviewResult.usage,
    });
  } catch (err) {
    console.error("[github-action] Review generation failed:", err);
    return Response.json({ error: "Review generation failed" }, { status: 500 });
  }
}
