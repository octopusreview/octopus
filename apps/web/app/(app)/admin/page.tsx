import { prisma } from "@octopus/db";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  IconUsers,
  IconBuilding,
  IconGitBranch,
  IconCurrencyDollar,
  IconBrain,
  IconApi,
} from "@tabler/icons-react";
import { getModelPricing, calcCost, formatUsd, formatNumber } from "@/lib/cost";

export default async function AdminOverviewPage() {
  const [userCount, orgCount, repoCount, aiTotals, aiByModel, platformByModel, pricing] =
    await Promise.all([
      prisma.user.count(),
      prisma.organization.count(),
      prisma.repository.count(),
      prisma.aiUsage.aggregate({
        _sum: {
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          cacheWriteTokens: true,
        },
        _count: true,
      }),
      prisma.aiUsage.groupBy({
        by: ["model"],
        _sum: {
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          cacheWriteTokens: true,
        },
        _count: true,
        orderBy: { _sum: { inputTokens: "desc" } },
      }),
      prisma.aiUsage.groupBy({
        by: ["model"],
        where: { usedOwnKey: false },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          cacheWriteTokens: true,
        },
        _count: true,
        orderBy: { _sum: { inputTokens: "desc" } },
      }),
      getModelPricing(),
    ]);

  const totalInput = aiTotals._sum.inputTokens ?? 0;
  const totalOutput = aiTotals._sum.outputTokens ?? 0;
  const totalTokens = totalInput + totalOutput;
  const totalCalls = aiTotals._count;

  const costReducer = (sum: number, row: typeof aiByModel[number]) =>
    sum +
    calcCost(
      pricing,
      row.model,
      row._sum?.inputTokens ?? 0,
      row._sum?.outputTokens ?? 0,
      row._sum?.cacheReadTokens ?? 0,
      row._sum?.cacheWriteTokens ?? 0,
    );

  const totalCost = aiByModel.reduce(costReducer, 0);
  const platformCost = platformByModel.reduce(costReducer, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Users</CardTitle>
            <IconUsers className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(userCount)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Organizations</CardTitle>
            <IconBuilding className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(orgCount)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Repositories</CardTitle>
            <IconGitBranch className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(repoCount)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Tokens</CardTitle>
            <IconBrain className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(totalTokens)}</div>
            <p className="text-xs text-muted-foreground">
              {formatNumber(totalInput)} in / {formatNumber(totalOutput)} out
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">API Calls</CardTitle>
            <IconApi className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(totalCalls)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Platform Cost</CardTitle>
            <IconCurrencyDollar className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {formatUsd(platformCost)}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatUsd(totalCost)} total
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
