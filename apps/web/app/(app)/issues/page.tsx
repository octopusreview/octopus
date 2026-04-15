import { headers, cookies } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { IssuesContent } from "@/components/issues/issues-content";

interface IssuesSearchParams {
  severity?: string;
  period?: string;
  status?: string;
}

const VALID_SEVERITIES = ["critical", "high", "medium", "low"];
const VALID_PERIODS = ["7d", "30d", "90d", "all"];
const VALID_STATUSES = ["open", "acknowledged", "all"];

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<IssuesSearchParams>;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) redirect("/login");

  const params = await searchParams;
  const filterSeverity = params.severity && VALID_SEVERITIES.includes(params.severity) ? params.severity : undefined;
  const filterPeriod = params.period && VALID_PERIODS.includes(params.period) ? params.period : "all";
  const filterStatus = params.status && VALID_STATUSES.includes(params.status) ? params.status : "open";

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;

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

  // Date filter
  let dateFilter: Date | undefined;
  if (filterPeriod !== "all") {
    const daysMap: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };
    dateFilter = new Date();
    dateFilter.setDate(dateFilter.getDate() - daysMap[filterPeriod]);
  }

  // Build where clause
  const where = {
    pullRequest: { repository: { organizationId: orgId } },
    ...(filterSeverity ? { severity: filterSeverity } : {}),
    ...(dateFilter ? { createdAt: { gte: dateFilter } } : {}),
    ...(filterStatus === "open"
      ? { acknowledgedAt: null }
      : filterStatus === "acknowledged"
        ? { acknowledgedAt: { not: null } }
        : {}),
  };

  // KPI counts (always unfiltered by severity to show all 3)
  const kpiWhere = {
    pullRequest: { repository: { organizationId: orgId } },
    ...(dateFilter ? { createdAt: { gte: dateFilter } } : {}),
    ...(filterStatus === "open"
      ? { acknowledgedAt: null }
      : filterStatus === "acknowledged"
        ? { acknowledgedAt: { not: null } }
        : {}),
  };

  const [issues, allForKpi, linearIntegration, org] = await Promise.all([
    prisma.reviewIssue.findMany({
      where,
      select: {
        id: true,
        title: true,
        description: true,
        severity: true,
        filePath: true,
        lineNumber: true,
        acknowledgedAt: true,
        feedback: true,
        createdAt: true,
        linearIssueId: true,
        linearIssueUrl: true,
        githubIssueNumber: true,
        githubIssueUrl: true,
        githubCommentId: true,
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
      take: 100,
    }),
    prisma.reviewIssue.findMany({
      where: kpiWhere,
      select: { severity: true },
    }),
    prisma.linearIntegration
      .findUnique({ where: { organizationId: orgId }, select: { accessToken: true } })
      .catch(() => null),
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { githubInstallationId: true },
    }),
  ]);

  const kpiCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const issue of allForKpi) {
    const sev = issue.severity.toLowerCase() as keyof typeof kpiCounts;
    if (sev in kpiCounts) kpiCounts[sev]++;
  }

  const linearConnected = !!linearIntegration;
  const githubConnected = org?.githubInstallationId !== null;

  // Schedule background sync of GitHub reactions (runs after response is sent)
  if (org?.githubInstallationId) {
    const pendingIssues = issues.filter(
      (i) => i.githubCommentId && !i.feedback,
    );

    if (pendingIssues.length > 0) {
      const installationId = org.githubInstallationId;
      after(async () => {
        try {
          const { getCommentReactions } = await import("@/lib/github");
          for (const issue of pendingIssues.slice(0, 20)) {
            try {
              const [owner, repoName] = issue.pullRequest.repository.fullName.split("/");
              const commentId = Number(issue.githubCommentId);
              if (isNaN(commentId) || commentId <= 0) continue;
              const reactions = await getCommentReactions(
                installationId,
                owner,
                repoName,
                commentId,
              );
              if (reactions.thumbsUp > 0 || reactions.thumbsDown > 0) {
                const vote = reactions.thumbsUp >= reactions.thumbsDown ? "up" : "down";
                await prisma.reviewIssue.update({
                  where: { id: issue.id },
                  data: { feedback: vote, feedbackAt: new Date(), feedbackBy: "github-reaction" },
                });
              }
            } catch {
              // silently ignore per-issue errors
            }
          }
        } catch (error) {
          console.error('[backgroundSync] Top-level error:', error);
        }
      });
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-10">
      <h1 className="text-2xl font-semibold tracking-tight">Issues</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        All code review issues across your repositories.
      </p>

      <IssuesContent
        issues={issues.map((i) => ({
          id: i.id,
          title: i.title,
          description: i.description,
          severity: i.severity,
          filePath: i.filePath,
          lineNumber: i.lineNumber,
          acknowledged: !!i.acknowledgedAt,
          createdAt: i.createdAt.toISOString(),
          linearIssueId: i.linearIssueId,
          linearIssueUrl: i.linearIssueUrl,
          feedback: i.feedback === "up" || i.feedback === "down" ? i.feedback : null,
          githubIssueNumber: i.githubIssueNumber,
          githubIssueUrl: i.githubIssueUrl,
          repoFullName: i.pullRequest.repository.fullName,
          repoProvider: i.pullRequest.repository.provider,
          prNumber: i.pullRequest.number,
          prTitle: i.pullRequest.title,
          prUrl: i.pullRequest.url,
        }))}
        kpiCounts={kpiCounts}
        currentSeverity={filterSeverity || "all"}
        currentPeriod={filterPeriod}
        currentStatus={filterStatus}
        linearConnected={linearConnected}
        githubConnected={githubConnected}
      />
    </div>
  );
}
