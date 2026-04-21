import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { Timeline } from "@/components/timeline";
import { getWeekData } from "@/app/(app)/timeline/actions";
import { getMondayOfWeek } from "@/app/(app)/timeline/week-helpers";
import { Card } from "@/components/ui/card";
import {
  IconGitPullRequest,
  IconCircleCheck,
  IconUsers,
  IconBug,
} from "@tabler/icons-react";

export default async function TimelinePage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) redirect("/login");

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

  const linearIntegration = await prisma.linearIntegration
    .findUnique({ where: { organizationId: orgId }, select: { id: true } })
    .catch(() => null);
  const linearConnected = !!linearIntegration;

  const jiraIntegration = await prisma.jiraIntegration
    .findUnique({ where: { organizationId: orgId }, select: { id: true } })
    .catch(() => null);
  const jiraConnected = !!jiraIntegration;

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { githubInstallationId: true },
  });
  const githubConnected = !!org?.githubInstallationId;

  // Current week boundaries
  const now = new Date();
  const monday = getMondayOfWeek(now);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  // Last week boundaries
  const lastMonday = new Date(monday);
  lastMonday.setDate(lastMonday.getDate() - 7);
  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastSunday.getDate() + 6);
  lastSunday.setHours(23, 59, 59, 999);

  const currentWeekStart = monday.toISOString().split("T")[0];
  const [week, lastWeek] = await Promise.all([
    getWeekData(orgId, monday, sunday),
    getWeekData(orgId, lastMonday, lastSunday),
  ]);

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-10">
      <div className="mb-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Weekly Timeline
        </h1>
      </div>
      <p className="text-muted-foreground text-sm">
        Review activity grouped by week
      </p>

      <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground sm:text-sm">
              PRs
            </span>
            <IconGitPullRequest className="text-muted-foreground size-3.5 sm:size-4" />
          </div>
          <div className="mt-1 text-2xl font-bold sm:text-3xl">
            {week.totalPrs}
          </div>
        </Card>

        <Card className="p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground sm:text-sm">
              Reviewed
            </span>
            <IconCircleCheck className="text-muted-foreground size-3.5 sm:size-4" />
          </div>
          <div className="mt-1 text-2xl font-bold sm:text-3xl">
            {week.totalReviewed}
          </div>
        </Card>

        <Card className="p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground sm:text-sm">
              Contributors
            </span>
            <IconUsers className="text-muted-foreground size-3.5 sm:size-4" />
          </div>
          <div className="mt-1 text-2xl font-bold sm:text-3xl">
            {week.totalContributors}
          </div>
        </Card>

        <Card className="p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground sm:text-sm">
              Issues
            </span>
            <IconBug className="text-muted-foreground size-3.5 sm:size-4" />
          </div>
          <div className="mt-1 text-2xl font-bold sm:text-3xl">
            {week.totalFindings}
          </div>
        </Card>
      </div>

      <div className="mt-8">
        <Timeline initialWeeks={[week, lastWeek]} currentWeekStart={currentWeekStart} linearConnected={linearConnected} jiraConnected={jiraConnected} githubConnected={githubConnected} />
      </div>
    </div>
  );
}
