import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  IconBrain,
  IconApi,
  IconChartBar,
  IconCurrencyDollar,
  IconChevronLeft,
  IconChevronRight,
  IconWallet,
  IconArrowRight,
} from "@tabler/icons-react";
import { getModelPricing, calcCost, formatUsd, formatNumber } from "@/lib/cost";
import { getOrgBalance } from "@/lib/credits";
import Link from "next/link";

// ── Month helpers ────────────────────────────────────────────────────

function parseMonth(param: string | undefined): { year: number; month: number } {
  const now = new Date();
  if (!param || !/^\d{4}-\d{2}$/.test(param)) {
    return { year: now.getFullYear(), month: now.getMonth() };
  }
  const [y, m] = param.split("-").map(Number);
  if (y < 2020 || y > 2099 || m < 1 || m > 12) {
    return { year: now.getFullYear(), month: now.getMonth() };
  }
  return { year: y, month: m - 1 }; // JS months are 0-indexed
}

function monthStart(year: number, month: number): Date {
  return new Date(year, month, 1);
}

function monthEnd(year: number, month: number): Date {
  return new Date(year, month + 1, 1);
}

function formatMonthParam(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function formatMonthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function prevMonth(year: number, month: number): { year: number; month: number } {
  return month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 };
}

function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 };
}

// ── Page ─────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: Promise<{ month?: string }>;
}

export default async function AnalyticsPage({ searchParams }: PageProps) {
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
    select: { organizationId: true },
  });

  if (!member) redirect("/complete-profile");

  const orgId = member.organizationId;
  const params = await searchParams;
  const { year, month } = parseMonth(params.month);
  const periodStart = monthStart(year, month);
  const periodEnd = monthEnd(year, month);

  const now = new Date();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const prev = prevMonth(year, month);
  const next = nextMonth(year, month);
  const isFutureNext = new Date(next.year, next.month, 1) > now;

  // Run all queries in parallel
  const [totals, byModel, byOperation, byModelOperation, dailyTrend, pricing, balance] = await Promise.all([
    prisma.aiUsage.aggregate({
      where: { organizationId: orgId, createdAt: { gte: periodStart, lt: periodEnd } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true },
      _count: true,
    }),

    prisma.aiUsage.groupBy({
      by: ["model"],
      where: { organizationId: orgId, createdAt: { gte: periodStart, lt: periodEnd } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true },
      _count: true,
      orderBy: { _sum: { inputTokens: "desc" } },
    }),

    prisma.aiUsage.groupBy({
      by: ["operation"],
      where: { organizationId: orgId, createdAt: { gte: periodStart, lt: periodEnd } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true },
      _count: true,
      orderBy: { _sum: { inputTokens: "desc" } },
    }),

    prisma.aiUsage.groupBy({
      by: ["model", "operation"],
      where: { organizationId: orgId, createdAt: { gte: periodStart, lt: periodEnd } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true },
    }),

    prisma.$queryRaw<
      { day: Date; input_tokens: bigint; output_tokens: bigint; calls: bigint }[]
    >`
      SELECT
        date_trunc('day', "createdAt") AS day,
        SUM("inputTokens")::bigint AS input_tokens,
        SUM("outputTokens")::bigint AS output_tokens,
        COUNT(*)::bigint AS calls
      FROM ai_usages
      WHERE "organizationId" = ${orgId}
        AND "createdAt" >= ${periodStart}
        AND "createdAt" < ${periodEnd}
      GROUP BY day
      ORDER BY day ASC
    `,
    getModelPricing(),
    getOrgBalance(orgId),
  ]);

  const totalInput = totals._sum.inputTokens ?? 0;
  const totalOutput = totals._sum.outputTokens ?? 0;
  const totalTokens = totalInput + totalOutput;
  const totalCalls = totals._count;
  const avgTokens = totalCalls > 0 ? Math.round(totalTokens / totalCalls) : 0;

  const totalCost = byModel.reduce((sum, row) => {
    return sum + calcCost(
      pricing,
      row.model,
      row._sum?.inputTokens ?? 0,
      row._sum?.outputTokens ?? 0,
      row._sum?.cacheReadTokens ?? 0,
      row._sum?.cacheWriteTokens ?? 0,
    );
  }, 0);

  const operationCostMap: Record<string, number> = {};
  for (const row of byModelOperation) {
    const op = row.operation;
    const cost = calcCost(
      pricing,
      row.model,
      row._sum?.inputTokens ?? 0,
      row._sum?.outputTokens ?? 0,
      row._sum?.cacheReadTokens ?? 0,
      row._sum?.cacheWriteTokens ?? 0,
    );
    operationCostMap[op] = (operationCostMap[op] ?? 0) + cost;
  }

  const dailyData = dailyTrend.map((d) => ({
    date: new Date(d.day).toISOString().split("T")[0],
    tokens: Number(d.input_tokens) + Number(d.output_tokens),
    calls: Number(d.calls),
  }));
  const maxDailyTokens = Math.max(...dailyData.map((d) => d.tokens), 1);

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6 md:p-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Usage</h1>
          <p className="text-muted-foreground text-sm">
            Token usage and cost analytics
          </p>
        </div>

        {/* Month navigation */}
        <div className="flex items-center gap-1">
          <Link
            href={`/usage?month=${formatMonthParam(prev.year, prev.month)}`}
            className="inline-flex size-8 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <IconChevronLeft className="size-4" />
          </Link>
          <span className="min-w-[140px] text-center text-sm font-medium">
            {formatMonthLabel(year, month)}
          </span>
          {isFutureNext ? (
            <span className="inline-flex size-8 items-center justify-center rounded-md border text-muted-foreground/30 cursor-not-allowed">
              <IconChevronRight className="size-4" />
            </span>
          ) : (
            <Link
              href={`/usage?month=${formatMonthParam(next.year, next.month)}`}
              className="inline-flex size-8 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <IconChevronRight className="size-4" />
            </Link>
          )}
        </div>
      </div>

      {/* Credit balance banner */}
      <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-full bg-primary/10">
            <IconWallet className="size-4 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Credit Balance</p>
            <p className="text-lg font-semibold">{formatUsd(balance.total)}</p>
          </div>
          {(balance.free > 0 || balance.purchased > 0) && (
            <div className="ml-4 flex gap-3 text-xs text-muted-foreground">
              {balance.free > 0 && <span>Free: {formatUsd(balance.free)}</span>}
              {balance.purchased > 0 && <span>Purchased: {formatUsd(balance.purchased)}</span>}
            </div>
          )}
        </div>
        <Link
          href="/settings/billing"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Manage Billing
          <IconArrowRight className="size-3.5" />
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Tokens
            </CardTitle>
            <IconBrain className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(totalTokens)}</div>
            <p className="text-xs text-muted-foreground">
              {formatNumber(totalInput)} input / {formatNumber(totalOutput)} output
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              API Calls
            </CardTitle>
            <IconApi className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(totalCalls)}</div>
            <p className="text-xs text-muted-foreground">
              {isCurrentMonth ? "This month" : formatMonthLabel(year, month)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Tokens/Call
            </CardTitle>
            <IconChartBar className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(avgTokens)}</div>
            <p className="text-xs text-muted-foreground">
              Per API call
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Estimated Cost
            </CardTitle>
            <IconCurrencyDollar className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatUsd(totalCost)}</div>
            <p className="text-xs text-muted-foreground">
              {isCurrentMonth ? "This month" : formatMonthLabel(year, month)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Model & Operation tables */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By Model</CardTitle>
          </CardHeader>
          <CardContent>
            {byModel.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data for this month</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 font-medium">Model</th>
                      <th className="pb-2 text-right font-medium">Input</th>
                      <th className="pb-2 text-right font-medium">Output</th>
                      <th className="pb-2 text-right font-medium">Total</th>
                      <th className="pb-2 text-right font-medium">Calls</th>
                      <th className="pb-2 text-right font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byModel.map((row) => {
                      const input = row._sum?.inputTokens ?? 0;
                      const output = row._sum?.outputTokens ?? 0;
                      const cacheRead = row._sum?.cacheReadTokens ?? 0;
                      const cacheWrite = row._sum?.cacheWriteTokens ?? 0;
                      const cost = calcCost(pricing, row.model, input, output, cacheRead, cacheWrite);
                      const count = typeof row._count === "number" ? row._count : (row._count as Record<string, number>)?._all ?? 0;
                      return (
                        <tr key={row.model} className="border-b last:border-0">
                          <td className="py-2 font-mono text-xs">{row.model}</td>
                          <td className="py-2 text-right">{formatNumber(input)}</td>
                          <td className="py-2 text-right">{formatNumber(output)}</td>
                          <td className="py-2 text-right font-medium">
                            {formatNumber(input + output)}
                          </td>
                          <td className="py-2 text-right">{count}</td>
                          <td className="py-2 text-right font-medium text-emerald-600 dark:text-emerald-400">{formatUsd(cost)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>By Operation</CardTitle>
          </CardHeader>
          <CardContent>
            {byOperation.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data for this month</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 font-medium">Operation</th>
                      <th className="pb-2 text-right font-medium">Input</th>
                      <th className="pb-2 text-right font-medium">Output</th>
                      <th className="pb-2 text-right font-medium">Total</th>
                      <th className="pb-2 text-right font-medium">Calls</th>
                      <th className="pb-2 text-right font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byOperation.map((row) => {
                      const input = row._sum?.inputTokens ?? 0;
                      const output = row._sum?.outputTokens ?? 0;
                      const cost = operationCostMap[row.operation] ?? 0;
                      const count = typeof row._count === "number" ? row._count : (row._count as Record<string, number>)?._all ?? 0;
                      return (
                        <tr key={row.operation} className="border-b last:border-0">
                          <td className="py-2 capitalize">{row.operation.replace(/-/g, " ")}</td>
                          <td className="py-2 text-right">{formatNumber(input)}</td>
                          <td className="py-2 text-right">{formatNumber(output)}</td>
                          <td className="py-2 text-right font-medium">
                            {formatNumber(input + output)}
                          </td>
                          <td className="py-2 text-right">{count}</td>
                          <td className="py-2 text-right font-medium text-emerald-600 dark:text-emerald-400">{formatUsd(cost)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Daily trend */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {dailyData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data for this month</p>
          ) : (
            <div className="space-y-2">
              {dailyData.map((d) => (
                <div key={d.date} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 text-muted-foreground">
                    {d.date.slice(5)}
                  </span>
                  <div className="flex-1">
                    <div
                      className="h-5 rounded bg-primary/20"
                      style={{
                        width: `${Math.max((d.tokens / maxDailyTokens) * 100, 1)}%`,
                      }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right font-mono text-xs">
                    {formatNumber(d.tokens)}
                  </span>
                  <span className="w-16 shrink-0 text-right text-muted-foreground">
                    {d.calls} calls
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
