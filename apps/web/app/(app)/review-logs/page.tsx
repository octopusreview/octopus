import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { ReviewLogsContent } from "@/components/review-logs/review-logs-content";

interface ReviewLogsSearchParams {
  search?: string;
  status?: string;
  page?: string;
}

const VALID_STATUSES = ["all", "pending", "reviewing", "completed", "failed"];
const PAGE_SIZE = 10;

export default async function ReviewLogsPage({
  searchParams,
}: {
  searchParams: Promise<ReviewLogsSearchParams>;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) redirect("/login");

  const params = await searchParams;
  const search = params.search?.trim() || "";
  const filterStatus =
    params.status && VALID_STATUSES.includes(params.status)
      ? params.status
      : "all";
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);

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

  const where = {
    repository: { organizationId: orgId },
    ...(filterStatus !== "all" ? { status: filterStatus } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" as const } },
            { author: { contains: search, mode: "insensitive" as const } },
            {
              repository: {
                fullName: { contains: search, mode: "insensitive" as const },
                organizationId: orgId,
              },
            },
            ...(isNaN(Number(search))
              ? []
              : [{ number: Number(search) }]),
          ],
        }
      : {}),
  };

  const [pullRequests, totalCount] = await Promise.all([
    prisma.pullRequest.findMany({
      where,
      select: {
        id: true,
        number: true,
        title: true,
        url: true,
        author: true,
        status: true,
        headSha: true,
        createdAt: true,
        updatedAt: true,
        repository: {
          select: {
            fullName: true,
            provider: true,
          },
        },
        _count: {
          select: { reviewIssues: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.pullRequest.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-10">
      <h1 className="text-2xl font-semibold tracking-tight">Review Logs</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        All PR reviews across your repositories.
      </p>

      <ReviewLogsContent
        pullRequests={pullRequests.map((pr) => ({
          id: pr.id,
          number: pr.number,
          title: pr.title,
          url: pr.url,
          author: pr.author,
          status: pr.status,
          repoFullName: pr.repository.fullName,
          repoProvider: pr.repository.provider,
          issueCount: pr._count.reviewIssues,
          createdAt: pr.createdAt.toISOString(),
          updatedAt: pr.updatedAt.toISOString(),
        }))}
        currentSearch={search}
        currentStatus={filterStatus}
        currentPage={page}
        totalPages={totalPages}
        totalCount={totalCount}
      />
    </div>
  );
}
