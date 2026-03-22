import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { Card } from "@/components/ui/card";
import {
  IconDatabase,
  IconActivity,
  IconCircleCheck,
} from "@tabler/icons-react";
import { TimeToMergeCard } from "@/components/dashboard/time-to-merge";
import { IssuesBySeverityCard } from "@/components/dashboard/issues-by-severity";
import { CommentsPerPrCard } from "@/components/dashboard/comments-per-pr";
import { PrsPerDeveloperCard } from "@/components/dashboard/prs-per-developer";
import { RecentIssuesCard } from "@/components/dashboard/recent-issues";
import { WeeklySummaryCard } from "@/components/dashboard/weekly-summary";
import { RepoTable } from "@/components/dashboard/repo-table";
import { SyncReposButton } from "@/components/sync-repos-button";
import { KpiFilters } from "@/components/dashboard/kpi-filters";
import { ProvidersBanner } from "@/components/dashboard/providers-banner";
import { OnboardingTips } from "@/components/dashboard/onboarding-tips";

// --- Constants ---

const VALID_REPO_ID = /^[a-zA-Z0-9_-]{1,50}$/;
const VALID_AUTHOR = /^[a-zA-Z0-9@._-]{1,100}$/;
const DISPLAYED_REPO_COUNT = 5;

// --- Helper functions ---

function formatDuration(minutes: number): string {
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) {
    const h = Math.round(minutes / 60);
    return `${h}h`;
  }
  const days = Math.floor(minutes / 1440);
  const hours = Math.round((minutes % 1440) / 60);
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function sanitizeParam(value: string | undefined, pattern: RegExp): string {
  if (!value) return "";
  return pattern.test(value) ? value : "";
}

interface DashboardSearchParams {
  repo?: string;
  author?: string;
  period?: string;
}

const periodConfig: Record<string, { days: number; chartBuckets: number; bucketDays: number }> = {
  "7d":  { days: 7,  chartBuckets: 7,  bucketDays: 1 },
  "30d": { days: 30, chartBuckets: 4,  bucketDays: 7 },
  "90d": { days: 90, chartBuckets: 12, bucketDays: 7 },
};

type BucketablePr = { updatedAt: Date; createdAt: Date; _count: { reviewIssues: number } };

function generateBuckets(
  prs: BucketablePr[],
  chartBuckets: number,
  bucketDays: number,
  now: Date,
) {
  const buckets: { date: string; prs: BucketablePr[] }[] = [];
  for (let i = chartBuckets - 1; i >= 0; i--) {
    const bucketEnd = new Date(now);
    bucketEnd.setDate(bucketEnd.getDate() - i * bucketDays);
    const bucketStart = new Date(bucketEnd);
    bucketStart.setDate(bucketStart.getDate() - bucketDays);

    const bucketPrs = prs.filter(
      (pr) => pr.updatedAt >= bucketStart && pr.updatedAt < bucketEnd
    );
    buckets.push({ date: formatDate(bucketStart), prs: bucketPrs });
  }
  return buckets;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) redirect("/login");

  const params = await searchParams;
  const filterRepo = sanitizeParam(params.repo, VALID_REPO_ID);
  const filterAuthor = sanitizeParam(params.author, VALID_AUTHOR);
  const filterPeriod = params.period && params.period in periodConfig ? params.period : "7d";
  const { days: periodDays, chartBuckets, bucketDays } = periodConfig[filterPeriod];

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;

  const member = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      ...(currentOrgId ? { organizationId: currentOrgId } : {}),
      deletedAt: null,
    },
    select: {
      organization: {
        select: {
          id: true,
          githubInstallationId: true,
          repositories: {
            where: { isActive: true },
            select: {
              id: true,
              name: true,
              fullName: true,
              provider: true,
              defaultBranch: true,
              isActive: true,
              indexStatus: true,
              indexedAt: true,
              indexedFiles: true,
              totalFiles: true,
              totalChunks: true,
              totalVectors: true,
              indexDurationMs: true,
              summary: true,
              purpose: true,
              analysisStatus: true,
              autoReview: true,
              pullRequests: {
                where: { status: { in: ["pending", "reviewing"] } },
                select: {
                  id: true,
                  number: true,
                  title: true,
                  url: true,
                  author: true,
                  status: true,
                  createdAt: true,
                },
                orderBy: { createdAt: "desc" },
                take: 10,
              },
            },
            orderBy: { updatedAt: "desc" },
          },
        },
      },
    },
  });

  if (!member) redirect("/complete-profile");

  const org = member.organization;
  const repos = org.repositories;
  const totalRepos = repos.length;
  const indexedRepos = repos.filter((r) => r.indexStatus === "indexed").length;
  const notIndexedRepos = totalRepos - indexedRepos;
  const githubConnected = org.githubInstallationId !== null;
  const githubAppSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";

  const bitbucketIntegration = await prisma.bitbucketIntegration.findUnique({
    where: { organizationId: org.id },
    select: { workspaceName: true },
  });
  const bitbucketConnected = !!bitbucketIntegration;
  const bannerDismissed = cookieStore.get("providers_banner_dismissed")?.value === "1";

  const hasIndexedRepo = repos.some((r) => r.indexStatus === "indexed");
  const hasAnalyzedRepo = repos.some((r) => r.analysisStatus === "analyzed" || r.analysisStatus === "completed");
  const hasAutoReviewRepo = repos.some((r) => r.autoReview === true);
  const onboardingComplete = hasIndexedRepo && hasAnalyzedRepo && hasAutoReviewRepo;
  const onboardingDismissed = cookieStore.get("onboarding_tips_dismissed")?.value === "1";

  // --- Chart Queries ---

  const now = new Date();
  const currentPeriodStart = new Date(now);
  currentPeriodStart.setDate(currentPeriodStart.getDate() - periodDays);
  const previousPeriodStart = new Date(now);
  previousPeriodStart.setDate(previousPeriodStart.getDate() - periodDays * 2);

  const repoFilter = filterRepo ? { id: filterRepo } : {};
  const prWhereFilter = {
    status: "completed" as const,
    updatedAt: { gte: previousPeriodStart },
    repository: { organizationId: org.id, ...repoFilter },
    ...(filterAuthor ? { author: filterAuthor } : {}),
  };

  const allCompletedPrs = await prisma.pullRequest.findMany({
    where: prWhereFilter,
    select: {
      author: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { reviewIssues: true } },
    },
  });

  // Unique authors for filter dropdown (all-time, unfiltered)
  const allAuthors = await prisma.pullRequest.findMany({
    where: { repository: { organizationId: org.id } },
    select: { author: true },
    distinct: ["author"],
  });
  const uniqueAuthors = allAuthors
    .map((p) => p.author)
    .filter(Boolean)
    .sort() as string[];

  const currentPeriodPrs = allCompletedPrs.filter((pr) => pr.updatedAt >= currentPeriodStart);
  const previousPeriodPrs = allCompletedPrs.filter(
    (pr) => pr.updatedAt < currentPeriodStart && pr.updatedAt >= previousPeriodStart
  );

  // All issues severity distribution
  const allIssues = await prisma.reviewIssue.findMany({
    where: { pullRequest: { repository: { organizationId: org.id } } },
    select: { severity: true },
  });

  // --- Time to Merge ---

  function computeTtm(prs: typeof currentPeriodPrs) {
    return prs.map((pr) => {
      const diff = pr.updatedAt.getTime() - pr.createdAt.getTime();
      return Math.max(0, diff / 60000);
    });
  }

  const currentTtmMinutes = computeTtm(currentPeriodPrs);
  const previousTtmMinutes = computeTtm(previousPeriodPrs);

  const currentTtmAvg =
    currentTtmMinutes.length > 0
      ? currentTtmMinutes.reduce((a, b) => a + b, 0) / currentTtmMinutes.length
      : 0;
  const previousTtmAvg =
    previousTtmMinutes.length > 0
      ? previousTtmMinutes.reduce((a, b) => a + b, 0) / previousTtmMinutes.length
      : 0;

  const ttmTrendPercent =
    previousTtmAvg > 0
      ? Math.round(((currentTtmAvg - previousTtmAvg) / previousTtmAvg) * 100)
      : null;

  // Build chart data using reusable bucket generator
  const buckets = generateBuckets(currentPeriodPrs, chartBuckets, bucketDays, now);

  const ttmChartData = buckets.map(({ date, prs }) => {
    const ttms = prs.map((pr) => Math.max(0, (pr.updatedAt.getTime() - pr.createdAt.getTime()) / 60000));
    const avg = ttms.length > 0 ? ttms.reduce((a, b) => a + b, 0) / ttms.length : 0;
    return { date, minutes: Math.round(avg) };
  });

  // --- Issues by Severity ---

  const severityCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const issue of allIssues) {
    const sev = issue.severity.toLowerCase();
    if (sev in severityCounts) severityCounts[sev]++;
  }
  const totalIssues = allIssues.length;

  const severityData = [
    { severity: "critical", count: severityCounts.critical, color: "#991b1b" },
    { severity: "high", count: severityCounts.high, color: "#ef4444" },
    { severity: "medium", count: severityCounts.medium, color: "#f59e0b" },
    { severity: "low", count: severityCounts.low, color: "#22c55e" },
  ].filter((d) => d.count > 0);

  // --- Issues per PR ---

  const issueCountsPerPr = currentPeriodPrs.map((pr) => pr._count.reviewIssues);
  const sortedIssueCounts = [...issueCountsPerPr].sort((a, b) => a - b);

  const issuesPerPrAvg =
    issueCountsPerPr.length > 0
      ? issueCountsPerPr.reduce((a, b) => a + b, 0) / issueCountsPerPr.length
      : 0;

  const issuesPerPrStats = {
    average: issueCountsPerPr.length > 0 ? issuesPerPrAvg.toFixed(1) : "N/A",
    p25: issueCountsPerPr.length > 0 ? percentile(sortedIssueCounts, 25).toFixed(1) : "N/A",
    p50: issueCountsPerPr.length > 0 ? percentile(sortedIssueCounts, 50).toFixed(1) : "N/A",
    p75: issueCountsPerPr.length > 0 ? percentile(sortedIssueCounts, 75).toFixed(1) : "N/A",
  };

  const issuesChartData = buckets.map(({ date, prs }) => {
    const issues = prs.map((pr) => pr._count.reviewIssues);
    const avg = issues.length > 0 ? issues.reduce((a, b) => a + b, 0) / issues.length : 0;
    return { date, issues: parseFloat(avg.toFixed(1)) };
  });

  // --- PRs per Developer ---

  const currentUniqueDevs = new Set(currentPeriodPrs.map((pr) => pr.author));
  const previousUniqueDevs = new Set(previousPeriodPrs.map((pr) => pr.author));

  const currentPrsPerDev =
    currentUniqueDevs.size > 0
      ? Math.round(currentPeriodPrs.length / currentUniqueDevs.size)
      : 0;
  const previousPrsPerDev =
    previousUniqueDevs.size > 0
      ? Math.round(previousPeriodPrs.length / previousUniqueDevs.size)
      : 0;

  const prsPerDevTrend =
    previousPrsPerDev > 0
      ? Math.round(((currentPrsPerDev - previousPrsPerDev) / previousPrsPerDev) * 100)
      : null;

  const prsChartData = buckets.map(({ date, prs }) => ({
    date,
    prs: prs.length,
  }));

  // --- Weekly summary ---

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const completedPrs = await prisma.pullRequest.findMany({
    where: {
      status: "completed",
      updatedAt: { gte: oneWeekAgo },
      repository: { organizationId: org.id },
    },
    select: {
      title: true,
      number: true,
      author: true,
      url: true,
      repository: { select: { fullName: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  type PrHighlight = { label: string; url: string };
  const weeklyByRepo = new Map<string, { prCount: number; highlights: PrHighlight[] }>();
  for (const pr of completedPrs) {
    const repoName = pr.repository.fullName;
    const entry = weeklyByRepo.get(repoName) ?? { prCount: 0, highlights: [] };
    entry.prCount++;
    entry.highlights.push({
      label: `#${pr.number} ${pr.title} (${pr.author})`,
      url: pr.url,
    });
    weeklyByRepo.set(repoName, entry);
  }

  const weeklySummary = Array.from(weeklyByRepo.entries())
    .map(([name, data]) => ({
      name,
      prCount: data.prCount,
      highlights: data.highlights.slice(0, 3),
    }))
    .sort((a, b) => b.prCount - a.prCount)
    .slice(0, 6);

  // Check if Collab integration is active
  const collabIntegration = await prisma.collabIntegration.findUnique({
    where: { organizationId: org.id },
    select: { isActive: true },
  });
  const collabConnected = collabIntegration?.isActive ?? false;

  // Check if Linear integration is active
  const linearIntegration = await prisma.linearIntegration
    .findUnique({ where: { organizationId: org.id }, select: { accessToken: true } })
    .catch(() => null);
  const linearConnected = !!linearIntegration;

  // Recent high-severity issues from code reviews
  const recentIssues = await prisma.reviewIssue.findMany({
    where: {
      severity: { in: ["critical", "high"] },
      acknowledgedAt: null,
      pullRequest: {
        repository: { organizationId: org.id },
      },
    },
    select: {
      id: true,
      title: true,
      description: true,
      severity: true,
      filePath: true,
      lineNumber: true,
      linearIssueId: true,
      linearIssueUrl: true,
      githubIssueNumber: true,
      githubIssueUrl: true,
      feedback: true,
      pullRequest: {
        select: {
          number: true,
          title: true,
          url: true,
          repository: { select: { fullName: true, provider: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 6,
  });

  // Fetch current Linear statuses for issues that have been linked
  const issueLinearStatuses: Record<string, { state: string; url: string; identifier: string }> = {};
  if (linearIntegration) {
    const linkedIssueIds = recentIssues
      .filter((i) => i.linearIssueId)
      .map((i) => i.linearIssueId as string);

    if (linkedIssueIds.length > 0) {
      try {
        const { getLinearIssueStatuses } = await import("@/lib/linear");
        const statusMap = await getLinearIssueStatuses(linkedIssueIds, linearIntegration.accessToken);
        for (const [id, status] of statusMap) {
          issueLinearStatuses[id] = status;
        }
      } catch (err) {
        console.error("[dashboard] Failed to fetch Linear statuses:", err);
      }
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-10">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Overview of your repositories and integrations.
      </p>

      {(!githubConnected || !bitbucketConnected) && !bannerDismissed && (
        <ProvidersBanner
          githubConnected={githubConnected}
          bitbucketConnected={bitbucketConnected}
          githubAppSlug={githubAppSlug}
          baseUrl={baseUrl}
        />
      )}

      {!onboardingComplete && !onboardingDismissed && (
        <OnboardingTips
          hasIndexedRepo={hasIndexedRepo}
          hasAnalyzedRepo={hasAnalyzedRepo}
          hasAutoReviewRepo={hasAutoReviewRepo}
        />
      )}

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Card className="p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground sm:text-sm">
              Total Repos
            </span>
            <IconDatabase className="text-muted-foreground size-3.5 sm:size-4" />
          </div>
          <div className="mt-1 text-2xl font-bold sm:text-3xl">{totalRepos}</div>
        </Card>

        <Card className="p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground sm:text-sm">
              Indexed
            </span>
            <IconCircleCheck className="text-muted-foreground size-3.5 sm:size-4" />
          </div>
          <div className="mt-1 text-2xl font-bold sm:text-3xl">{indexedRepos}</div>
        </Card>

        <Card className="p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground sm:text-sm">
              Not Indexed
            </span>
            <IconActivity className="text-muted-foreground size-3.5 sm:size-4" />
          </div>
          <div className="mt-1 text-2xl font-bold sm:text-3xl">{notIndexedRepos}</div>
          {notIndexedRepos > 0 && (
            <a
              href="/repositories"
              className="mt-1 block text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors sm:text-xs"
            >
              Start indexing &rarr;
            </a>
          )}
        </Card>
      </div>

      <div className="mt-8">
        <KpiFilters
          repos={repos.map((r) => ({ id: r.id, name: r.name }))}
          authors={uniqueAuthors}
          currentRepo={filterRepo || "all"}
          currentAuthor={filterAuthor || "all"}
          currentPeriod={filterPeriod}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <TimeToMergeCard
          chartData={ttmChartData}
          averageFormatted={currentPeriodPrs.length > 0 ? formatDuration(currentTtmAvg) : "N/A"}
          trendPercent={ttmTrendPercent}
        />
        <IssuesBySeverityCard data={severityData} total={totalIssues} />
        <CommentsPerPrCard chartData={issuesChartData} stats={issuesPerPrStats} />
        <PrsPerDeveloperCard
          chartData={prsChartData}
          averagePrsPerDev={currentPrsPerDev}
          trendPercent={prsPerDevTrend}
        />
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold">Activity</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Understand your team&apos;s code review performance at a glance
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <RecentIssuesCard
            issues={recentIssues.map((i) => ({
              id: i.id,
              title: i.title,
              description: i.description,
              severity: i.severity,
              filePath: i.filePath,
              lineNumber: i.lineNumber,
              linearIssueId: i.linearIssueId,
              linearIssueUrl: i.linearIssueUrl,
              githubIssueNumber: i.githubIssueNumber,
              githubIssueUrl: i.githubIssueUrl,
              feedback: i.feedback === "up" || i.feedback === "down" ? i.feedback : null,
              repoFullName: i.pullRequest.repository.fullName,
              repoProvider: i.pullRequest.repository.provider,
              prNumber: i.pullRequest.number,
              prTitle: i.pullRequest.title,
              prUrl: i.pullRequest.url,
            }))}
            collabConnected={collabConnected}
            linearConnected={linearConnected}
            githubConnected={githubConnected}
            issueLinearStatuses={issueLinearStatuses}
          />
          <WeeklySummaryCard repos={weeklySummary} />
        </div>
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Repositories</h2>
          <div className="flex items-center gap-3">
            <SyncReposButton />
            <a href="/repositories" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              See all &rarr;
            </a>
          </div>
        </div>
        <RepoTable
          repos={repos.slice(0, DISPLAYED_REPO_COUNT).map((r) => ({
            ...r,
            indexedAt: r.indexedAt?.toISOString() ?? null,
            pullRequests: r.pullRequests.map((pr) => ({
              ...pr,
              createdAt: pr.createdAt.toISOString(),
            })),
          }))}
          orgId={org.id}
          githubAppSlug={githubAppSlug ?? null}
        />
      </div>
    </div>
  );
}
