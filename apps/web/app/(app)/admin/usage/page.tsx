import { prisma } from "@octopus/db";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getModelPricing, calcCost, formatUsd, formatNumber } from "@/lib/cost";

export default async function AdminUsagePage() {
  const [aiByModel, pricing] = await Promise.all([
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Cost by Model</CardTitle>
        <p className="text-xs text-muted-foreground">Excluding organizations with their own API key</p>
      </CardHeader>
      <CardContent>
        {aiByModel.length === 0 ? (
          <p className="text-sm text-muted-foreground">No AI usage yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Model</th>
                  <th className="pb-2 text-right font-medium">Input</th>
                  <th className="pb-2 text-right font-medium">Output</th>
                  <th className="pb-2 text-right font-medium">Calls</th>
                  <th className="pb-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {aiByModel.map((row) => {
                  const input = row._sum?.inputTokens ?? 0;
                  const output = row._sum?.outputTokens ?? 0;
                  const cacheRead = row._sum?.cacheReadTokens ?? 0;
                  const cacheWrite = row._sum?.cacheWriteTokens ?? 0;
                  const cost = calcCost(pricing, row.model, input, output, cacheRead, cacheWrite);
                  const count =
                    typeof row._count === "number"
                      ? row._count
                      : ((row._count as Record<string, number>)?._all ?? 0);
                  return (
                    <tr key={row.model} className="border-b last:border-0">
                      <td className="py-2 font-mono text-xs">{row.model}</td>
                      <td className="py-2 text-right">{formatNumber(input)}</td>
                      <td className="py-2 text-right">{formatNumber(output)}</td>
                      <td className="py-2 text-right">{count}</td>
                      <td className="py-2 text-right font-medium text-emerald-600 dark:text-emerald-400">
                        {formatUsd(cost)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
