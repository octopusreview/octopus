import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { RepositoriesContent } from "./repositories-content";

const PAGE_SIZE = 50;

export default async function RepositoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string; search?: string; owner?: string; page?: string; filter?: string }>;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;

  // Step 1: Get organization membership
  const member = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      ...(currentOrgId ? { organizationId: currentOrgId } : {}),
      deletedAt: null,
    },
    select: {
      organization: { select: { id: true } },
    },
  });

  if (!member) redirect("/complete-profile");

  const orgId = member.organization.id;
  const { repo: selectedRepoId, search = "", owner = "", page: pageStr, filter = "" } = await searchParams;
  const page = Math.max(1, Number(pageStr) || 1);

  // Build where clause for repository query
  const baseWhere: Record<string, unknown> = {
    organizationId: orgId,
    isActive: true,
  };

  if (search) {
    baseWhere.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { fullName: { contains: search, mode: "insensitive" } },
    ];
  }

  if (owner) {
    baseWhere.fullName = { startsWith: owner + "/" };
  }

  if (filter === "not-indexed") {
    baseWhere.indexStatus = { notIn: ["indexed", "stale"] };
  } else if (filter === "indexed") {
    baseWhere.indexStatus = "indexed";
  } else if (filter === "stale") {
    baseWhere.indexStatus = "stale";
  } else if (filter === "failed") {
    baseWhere.indexStatus = "failed";
  }

  const repoSelect = {
    id: true,
    name: true,
    fullName: true,
    provider: true,
    defaultBranch: true,
    isActive: true,
    autoReview: true,
    indexStatus: true,
    indexedAt: true,
    indexedFiles: true,
    totalFiles: true,
    totalChunks: true,
    totalVectors: true,
    indexDurationMs: true,
    contributorCount: true,
    analysisStatus: true,
    analyzedAt: true,
    reviewModelId: true,
    embedModelId: true,
    reviewConfig: true,
    _count: {
      select: { pullRequests: true },
    },
  } as const;

  // Step 2: All queries in parallel
  const [repos, totalCount, allRepoNames, favoriteRepos, otherOrgMemberships, availableModels, bitbucketIntegration] = await Promise.all([
    // Paginated repos — light select, no heavy fields
    prisma.repository.findMany({
      where: baseWhere,
      select: repoSelect,
      orderBy: [{ indexedAt: { sort: "desc", nulls: "last" } }, { name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),

    // Total count for pagination
    prisma.repository.count({ where: baseWhere }),

    // All repo names for owner filter dropdown (lightweight)
    prisma.repository.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { fullName: true },
    }),

    // User favorites
    prisma.favoriteRepository.findMany({
      where: { userId: session.user.id },
      select: { repositoryId: true },
    }),

    // Other orgs for transfer feature
    prisma.organizationMember.findMany({
      where: {
        userId: session.user.id,
        deletedAt: null,
        organizationId: { not: orgId },
        organization: { deletedAt: null, bannedAt: null },
      },
      select: {
        organization: { select: { id: true, name: true, slug: true } },
      },
    }),

    // Available AI models
    prisma.availableModel.findMany({
      where: { isActive: true },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
      select: { modelId: true, displayName: true, provider: true, category: true },
    }),

    // Bitbucket integration check
    prisma.bitbucketIntegration.findUnique({
      where: { organizationId: orgId },
      select: { workspaceSlug: true },
    }),
  ]);

  const favoriteRepoIds = favoriteRepos.map((f) => f.repositoryId);
  const paginatedRepoIds = new Set(repos.map((r) => r.id));

  // Fetch favorite repos + selected repo that are NOT already in the paginated results
  const missingIds = [
    ...favoriteRepoIds.filter((id) => !paginatedRepoIds.has(id)),
    ...(selectedRepoId && !paginatedRepoIds.has(selectedRepoId) && !favoriteRepoIds.includes(selectedRepoId)
      ? [selectedRepoId]
      : []),
  ];

  const missingRepos = missingIds.length > 0
    ? await prisma.repository.findMany({
        where: { id: { in: missingIds }, organizationId: orgId, isActive: true },
        select: repoSelect,
      })
    : [];

  // Merge: paginated repos + missing favorites/selected (deduped by Set above)
  const allRepos = [...repos, ...missingRepos];

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const owners = [...new Set(allRepoNames.map((r) => r.fullName.split("/")[0]))].sort();
  const otherOrgs = otherOrgMemberships.map((m) => m.organization);

  const mappedRepos = allRepos.map((r) => ({
    id: r.id,
    name: r.name,
    fullName: r.fullName,
    provider: r.provider,
    defaultBranch: r.defaultBranch,
    isActive: r.isActive,
    autoReview: r.autoReview,
    indexStatus: r.indexStatus,
    indexedAt: r.indexedAt?.toISOString() ?? null,
    indexedFiles: r.indexedFiles,
    totalFiles: r.totalFiles,
    totalChunks: r.totalChunks,
    totalVectors: r.totalVectors,
    indexDurationMs: r.indexDurationMs,
    contributorCount: r.contributorCount,
    analysisStatus: r.analysisStatus,
    analyzedAt: r.analyzedAt?.toISOString() ?? null,
    reviewModelId: r.reviewModelId,
    embedModelId: r.embedModelId,
    reviewConfig: (r.reviewConfig as Record<string, unknown>) ?? {},
    pullRequestCount: r._count.pullRequests,
  }));

  const baseUrl = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return (
    <RepositoriesContent
      repos={mappedRepos}
      orgId={orgId}
      selectedRepoId={selectedRepoId ?? null}
      githubAppSlug={process.env.NEXT_PUBLIC_GITHUB_APP_SLUG ?? null}
      favoriteRepoIds={favoriteRepoIds}
      availableModels={availableModels}
      baseUrl={baseUrl}
      otherOrgs={otherOrgs}
      owners={owners}
      currentSearch={search}
      currentOwner={owner}
      currentFilter={filter}
      currentPage={page}
      totalPages={totalPages}
      totalCount={totalCount}
      bitbucketWorkspaceSlug={bitbucketIntegration?.workspaceSlug ?? null}
    />
  );
}
