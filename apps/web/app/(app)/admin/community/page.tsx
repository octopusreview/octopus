import { prisma } from "@octopus/db";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getModelPricing, calcCost, formatUsd, formatNumber } from "@/lib/cost";

export default async function AdminCommunityPage() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - 7);
  startOfWeek.setHours(0, 0, 0, 0);

  const [
    communityOrgs,
    todayReviews,
    weekReviews,
    pricing,
    aiUsage,
    recentTypeChanges,
    topRepos,
  ] = await Promise.all([
    prisma.organization.findMany({
      where: { type: 2 },
      select: {
        id: true,
        name: true,
        slug: true,
        bannedAt: true,
        createdAt: true,
        _count: {
          select: { repositories: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.aiUsage.count({
      where: {
        operation: "review",
        createdAt: { gte: startOfDay },
        organization: { type: 2 },
      },
    }),
    prisma.aiUsage.count({
      where: {
        operation: "review",
        createdAt: { gte: startOfWeek },
        organization: { type: 2 },
      },
    }),
    getModelPricing(),
    prisma.aiUsage.groupBy({
      by: ["organizationId", "model"],
      where: { organization: { type: 2 } },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
      },
      _count: true,
    }),
    prisma.orgTypeChange.findMany({
      where: {
        OR: [{ fromType: 2 }, { toType: 2 }],
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        organization: { select: { name: true, slug: true } },
      },
    }),
    prisma.repository.findMany({
      where: {
        organization: { type: 2 },
        isActive: true,
      },
      select: {
        id: true,
        fullName: true,
        _count: { select: { pullRequests: true } },
        organization: { select: { name: true } },
      },
      orderBy: { pullRequests: { _count: "desc" } },
      take: 10,
    }),
  ]);

  // Total cost for community orgs
  let totalCost = 0;
  for (const row of aiUsage) {
    const input = row._sum?.inputTokens ?? 0;
    const output = row._sum?.outputTokens ?? 0;
    const cacheRead = row._sum?.cacheReadTokens ?? 0;
    const cacheWrite = row._sum?.cacheWriteTokens ?? 0;
    totalCost += calcCost(pricing, row.model, input, output, cacheRead, cacheWrite);
  }

  // Conversion count (community → standard)
  const conversions = recentTypeChanges.filter(
    (c) => c.fromType === 2 && c.toType === 1,
  ).length;

  const TYPE_LABELS: Record<number, string> = {
    1: "Standard",
    2: "Community",
    3: "Friendly",
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Community Orgs</div>
            <div className="text-2xl font-bold">{communityOrgs.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Reviews Today</div>
            <div className="text-2xl font-bold">{todayReviews}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Reviews This Week</div>
            <div className="text-2xl font-bold">{weekReviews}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Total Cost</div>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {formatUsd(totalCost)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Top repos */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Community Repos</CardTitle>
          </CardHeader>
          <CardContent>
            {topRepos.length === 0 ? (
              <p className="text-sm text-muted-foreground">No community repos yet.</p>
            ) : (
              <div className="space-y-2">
                {topRepos.map((repo) => (
                  <div key={repo.id} className="flex items-center justify-between text-sm">
                    <div>
                      <span className="font-mono">{repo.fullName}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {repo.organization.name}
                      </span>
                    </div>
                    <Badge variant="secondary">{repo._count.pullRequests} PRs</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent type changes */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Type Changes</CardTitle>
          </CardHeader>
          <CardContent>
            {recentTypeChanges.length === 0 ? (
              <p className="text-sm text-muted-foreground">No type changes yet.</p>
            ) : (
              <div className="space-y-2">
                {recentTypeChanges.map((change) => (
                  <div key={change.id} className="flex items-center justify-between text-sm">
                    <div>
                      <span className="font-medium">{change.organization.name}</span>
                      <span className="mx-1.5 text-muted-foreground">
                        {TYPE_LABELS[change.fromType]} &rarr; {TYPE_LABELS[change.toType]}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {change.createdAt.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Community orgs table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Community Organizations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 text-right font-medium">Repos</th>
                  <th className="pb-2 text-right font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {communityOrgs.map((org) => (
                  <tr key={org.id} className="border-b">
                    <td className="py-2">
                      <div>{org.name}</div>
                      <div className="text-xs text-muted-foreground">{org.slug}</div>
                    </td>
                    <td className="py-2">
                      {org.bannedAt ? (
                        <Badge variant="destructive">Banned</Badge>
                      ) : (
                        <Badge variant="secondary">Active</Badge>
                      )}
                    </td>
                    <td className="py-2 text-right">{org._count.repositories}</td>
                    <td className="py-2 text-right text-muted-foreground">
                      {org.createdAt.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
