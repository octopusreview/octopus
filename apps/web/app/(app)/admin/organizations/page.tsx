import { Fragment } from "react";
import { prisma } from "@octopus/db";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OrgBanToggle } from "../ban-toggle";
import { OrgTypeSelector } from "../org-type-selector";
import { ORG_TYPE_LABELS } from "../org-types";
import { getModelPricing, calcCost, formatUsd, formatNumber } from "@/lib/cost";

const TYPE_BADGE_VARIANT: Record<number, "default" | "secondary" | "outline"> = {
  1: "default",
  2: "secondary",
  3: "outline",
};

export default async function AdminOrganizationsPage() {
  const [allOrgs, aiByOrg, pricing] = await Promise.all([
    prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        bannedAt: true,
        anthropicApiKey: true,
        createdAt: true,
        _count: {
          select: {
            members: true,
            repositories: true,
          },
        },
      },
    }),
    prisma.aiUsage.groupBy({
      by: ["organizationId", "model"],
      _sum: {
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
      },
      _count: true,
    }),
    getModelPricing(),
  ]);

  const orgUsageMap = new Map<
    string,
    { model: string; input: number; output: number; cacheRead: number; cacheWrite: number; calls: number; cost: number }[]
  >();
  for (const row of aiByOrg) {
    const input = row._sum?.inputTokens ?? 0;
    const output = row._sum?.outputTokens ?? 0;
    const cacheRead = row._sum?.cacheReadTokens ?? 0;
    const cacheWrite = row._sum?.cacheWriteTokens ?? 0;
    const calls = typeof row._count === "number" ? row._count : ((row._count as Record<string, number>)?._all ?? 0);
    const cost = calcCost(pricing, row.model, input, output, cacheRead, cacheWrite);
    if (!orgUsageMap.has(row.organizationId)) orgUsageMap.set(row.organizationId, []);
    orgUsageMap.get(row.organizationId)!.push({ model: row.model, input, output, cacheRead, cacheWrite, calls, cost });
  }

  const sortedOrgs = [...allOrgs].sort((a, b) => {
    const aTokens = (orgUsageMap.get(a.id) ?? []).reduce((s, u) => s + u.input + u.output, 0);
    const bTokens = (orgUsageMap.get(b.id) ?? []).reduce((s, u) => s + u.input + u.output, 0);
    return bTokens - aTokens;
  });

  // Stats by type
  const typeStats = new Map<number, { count: number; repos: number; cost: number }>();
  for (const org of allOrgs) {
    const prev = typeStats.get(org.type) ?? { count: 0, repos: 0, cost: 0 };
    const orgCost = (orgUsageMap.get(org.id) ?? []).reduce((s, u) => s + u.cost, 0);
    typeStats.set(org.type, {
      count: prev.count + 1,
      repos: prev.repos + org._count.repositories,
      cost: prev.cost + orgCost,
    });
  }

  return (
    <div className="space-y-6">
      {/* Type summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[1, 2, 3].map((type) => {
          const stats = typeStats.get(type) ?? { count: 0, repos: 0, cost: 0 };
          return (
            <Card key={type}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center justify-between">
                  <Badge variant={TYPE_BADGE_VARIANT[type]}>{ORG_TYPE_LABELS[type]}</Badge>
                  <span className="text-2xl font-bold">{stats.count}</span>
                </div>
                <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
                  <span>{stats.repos} repos</span>
                  <span>{formatUsd(stats.cost)} cost</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Organizations table */}
      <Card>
        <CardHeader>
          <CardTitle>Organizations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 text-right font-medium">Members</th>
                  <th className="pb-2 text-right font-medium">Repos</th>
                  <th className="pb-2 text-right font-medium">Tokens</th>
                  <th className="pb-2 text-right font-medium">Cost</th>
                  <th className="pb-2 text-right font-medium">Created</th>
                  <th className="pb-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedOrgs.map((org) => {
                  const usage = orgUsageMap.get(org.id) ?? [];
                  const orgTotalTokens = usage.reduce((s, u) => s + u.input + u.output, 0);
                  const orgTotalCost = usage.reduce((s, u) => s + u.cost, 0);
                  return (
                    <Fragment key={org.id}>
                      <tr className="border-b">
                        <td className="py-2">
                          <div className="flex items-center gap-1.5">
                            {org.name}
                            {org.anthropicApiKey && (
                              <Badge variant="outline" className="text-[10px] px-1 h-4">Own Key</Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{org.slug}</div>
                        </td>
                        <td className="py-2">
                          <OrgTypeSelector orgId={org.id} currentType={org.type} />
                        </td>
                        <td className="py-2">
                          {org.bannedAt ? (
                            <Badge variant="destructive">Banned</Badge>
                          ) : (
                            <Badge variant="secondary">Active</Badge>
                          )}
                        </td>
                        <td className="py-2 text-right">{org._count.members}</td>
                        <td className="py-2 text-right">{org._count.repositories}</td>
                        <td className="py-2 text-right">{formatNumber(orgTotalTokens)}</td>
                        <td className="py-2 text-right font-medium text-emerald-600 dark:text-emerald-400">
                          {formatUsd(orgTotalCost)}
                        </td>
                        <td className="py-2 text-right text-muted-foreground">
                          {org.createdAt.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </td>
                        <td className="py-2 text-right">
                          <OrgBanToggle
                            orgId={org.id}
                            orgName={org.name}
                            isBanned={!!org.bannedAt}
                          />
                        </td>
                      </tr>
                      {usage.length > 0 && usage.map((u) => (
                        <tr key={`${org.id}-${u.model}`} className="border-b last:border-0 bg-muted/30">
                          <td className="py-1.5 pl-6 text-xs text-muted-foreground" colSpan={3}>
                            <span className="font-mono">{u.model}</span>
                          </td>
                          <td className="py-1.5 text-right text-xs text-muted-foreground" colSpan={2}>
                            {formatNumber(u.calls)} calls
                          </td>
                          <td className="py-1.5 text-right text-xs text-muted-foreground">
                            {formatNumber(u.input + u.output)}
                          </td>
                          <td className="py-1.5 text-right text-xs text-muted-foreground">
                            {formatUsd(u.cost)}
                          </td>
                          <td colSpan={2} />
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
