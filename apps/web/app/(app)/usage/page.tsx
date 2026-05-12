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
  IconCurrencyDollar,
  IconChevronLeft,
  IconChevronRight,
  IconWallet,
  IconArrowRight,
  IconGitPullRequest,
  IconReceipt,
} from "@tabler/icons-react";
import { getModelPricing, calcCost, formatUsd } from "@/lib/cost";
import { getOrgBalance } from "@/lib/credits";
import Link from "@/components/link";

// ── Activity categories ──────────────────────────────────────────────
// Group internal pipeline operations into user-facing activities.

type Activity = {
  key: string;
  label: string;
  description: string;
  operations: string[];
  // Operations whose call count maps 1:1 to a user-visible unit
  // (e.g. "review" calls correspond to actual reviews run).
  unitOperations?: string[];
  unit?: string;
};

const ACTIVITIES: Activity[] = [
  {
    key: "reviews",
    label: "Code Reviews",
    description: "PR reviews and findings",
    operations: [
      "review",
      "review-validation",
      "review-rerank",
      "review-findings-followup",
      "finding-verification",
      "cross-file-verification",
      "local-review",
      "local-review-findings-followup",
      "community-review",
      "generate-issue-content",
      "feedback-classification",
    ],
    unitOperations: ["review", "local-review", "community-review"],
    unit: "reviews",
  },
  {
    key: "indexing",
    label: "Repo Indexing",
    description: "Understanding your codebase",
    operations: [
      "embedding",
      "analyze",
      "summarize-repo",
      "summarize-daily",
      "knowledge-enhance",
      "package-analyze-deep-dive",
    ],
    unitOperations: ["analyze"],
    unit: "repos",
  },
  {
    key: "chat",
    label: "Chat & Assistant",
    description: "In-app and Slack conversations",
    operations: [
      "chat",
      "chat-rerank",
      "chat-title",
      "slack-command",
      "slack-command-embedding",
    ],
    unitOperations: ["chat", "slack-command"],
    unit: "messages",
  },
];

function activityFor(operation: string): Activity | null {
  for (const a of ACTIVITIES) {
    if (a.operations.includes(operation)) return a;
  }
  return null;
}

// Map raw model IDs to short, friendly labels for display.
function shortModelLabel(model: string): string {
  if (model.startsWith("claude-opus-4-6")) return "Claude Opus 4.6";
  if (model.startsWith("claude-opus-4")) return "Claude Opus 4";
  if (model.startsWith("claude-sonnet-4-6")) return "Claude Sonnet 4.6";
  if (model.startsWith("claude-sonnet-4")) return "Claude Sonnet 4";
  if (model.startsWith("claude-haiku-4-5")) return "Claude Haiku 4.5";
  if (model.startsWith("claude-haiku")) return "Claude Haiku";
  if (model.startsWith("gemini-2.5-pro")) return "Gemini 2.5 Pro";
  if (model.startsWith("gemini-2.5-flash")) return "Gemini 2.5 Flash";
  return model;
}

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
  return { year: y, month: m - 1 };
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

  const [byModelOperation, dailyByModel, pricing, balance] = await Promise.all([
    prisma.aiUsage.groupBy({
      by: ["model", "operation"],
      where: { organizationId: orgId, createdAt: { gte: periodStart, lt: periodEnd } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true },
      _count: true,
    }),

    prisma.$queryRaw<
      {
        day: Date;
        model: string;
        input_tokens: bigint;
        output_tokens: bigint;
        cache_read_tokens: bigint;
        cache_write_tokens: bigint;
      }[]
    >`
      SELECT
        date_trunc('day', "createdAt") AS day,
        model,
        SUM("inputTokens")::bigint AS input_tokens,
        SUM("outputTokens")::bigint AS output_tokens,
        SUM("cacheReadTokens")::bigint AS cache_read_tokens,
        SUM("cacheWriteTokens")::bigint AS cache_write_tokens
      FROM ai_usages
      WHERE "organizationId" = ${orgId}
        AND "createdAt" >= ${periodStart}
        AND "createdAt" < ${periodEnd}
      GROUP BY day, model
      ORDER BY day ASC
    `,

    getModelPricing(),
    getOrgBalance(orgId),
  ]);

  // Aggregate cost & calls per activity and per model
  const activityStats = new Map<
    string,
    { cost: number; calls: number; unitCalls: number }
  >();
  for (const a of ACTIVITIES) {
    activityStats.set(a.key, { cost: 0, calls: 0, unitCalls: 0 });
  }

  const modelStats = new Map<string, { cost: number; calls: number }>();

  let totalCost = 0;

  for (const row of byModelOperation) {
    const cost = calcCost(
      pricing,
      row.model,
      row._sum?.inputTokens ?? 0,
      row._sum?.outputTokens ?? 0,
      row._sum?.cacheReadTokens ?? 0,
      row._sum?.cacheWriteTokens ?? 0,
    );
    totalCost += cost;

    const count =
      typeof row._count === "number"
        ? row._count
        : (row._count as Record<string, number>)?._all ?? 0;

    const m = modelStats.get(row.model) ?? { cost: 0, calls: 0 };
    m.cost += cost;
    m.calls += count;
    modelStats.set(row.model, m);

    const activity = activityFor(row.operation);
    if (!activity) continue;

    const stats = activityStats.get(activity.key)!;
    stats.cost += cost;
    stats.calls += count;
    if (activity.unitOperations?.includes(row.operation)) {
      stats.unitCalls += count;
    }
  }

  const reviewsRun = activityStats.get("reviews")?.unitCalls ?? 0;
  const avgPerReview = reviewsRun > 0 ? totalCost / reviewsRun : 0;

  // Bucket infra-only models (embeddings, rerank) under a single "Other" row.
  const OTHER_MODEL_PREFIXES = ["text-embedding", "rerank"];
  const namedRows: { model: string; label: string; cost: number; calls: number }[] = [];
  const otherBucket = { cost: 0, calls: 0 };
  for (const [model, s] of modelStats) {
    if (OTHER_MODEL_PREFIXES.some((p) => model.startsWith(p))) {
      otherBucket.cost += s.cost;
      otherBucket.calls += s.calls;
    } else {
      namedRows.push({ model, label: shortModelLabel(model), ...s });
    }
  }
  namedRows.sort((a, b) => b.cost - a.cost);
  const modelRows = [...namedRows];
  if (otherBucket.cost > 0 || otherBucket.calls > 0) {
    modelRows.push({ model: "__other__", label: "Other", ...otherBucket });
  }

  // Daily cost
  const dailyCostMap = new Map<string, number>();
  for (const row of dailyByModel) {
    const date = new Date(row.day).toISOString().split("T")[0];
    const cost = calcCost(
      pricing,
      row.model,
      Number(row.input_tokens),
      Number(row.output_tokens),
      Number(row.cache_read_tokens),
      Number(row.cache_write_tokens),
    );
    dailyCostMap.set(date, (dailyCostMap.get(date) ?? 0) + cost);
  }
  const dailyData = Array.from(dailyCostMap.entries())
    .map(([date, cost]) => ({ date, cost }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const maxDailyCost = Math.max(...dailyData.map((d) => d.cost), 0.0001);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 md:p-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Usage</h1>
          <p className="text-muted-foreground text-sm">
            Where your credits go
          </p>
        </div>

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
      <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-full bg-primary/10">
            <IconWallet className="size-4 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Credit Balance</p>
            <p className="text-lg font-semibold leading-tight">{formatUsd(balance.total)}</p>
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

      {/* Stat cards (compact) */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              {isCurrentMonth ? "This Month" : formatMonthLabel(year, month)}
            </CardTitle>
            <IconCurrencyDollar className="size-3.5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold">{formatUsd(totalCost)}</div>
            <p className="text-xs text-muted-foreground">Total spend</p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Reviews Run
            </CardTitle>
            <IconGitPullRequest className="size-3.5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold">{reviewsRun.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">PRs and local reviews</p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Avg per Review
            </CardTitle>
            <IconReceipt className="size-3.5 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold">{formatUsd(avgPerReview)}</div>
            <p className="text-xs text-muted-foreground">Including indexing & chat</p>
          </CardContent>
        </Card>
      </div>

      {/* Two-column: Activity + Models */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>By Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {totalCost === 0 ? (
              <p className="text-sm text-muted-foreground">No usage this month</p>
            ) : (
              <div className="space-y-2">
                {ACTIVITIES.map((a) => {
                  const stats = activityStats.get(a.key) ?? { cost: 0, calls: 0, unitCalls: 0 };
                  const pct = totalCost > 0 ? (stats.cost / totalCost) * 100 : 0;
                  return (
                    <div key={a.key} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {a.label}
                          {a.unit && stats.unitCalls > 0 && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              {stats.unitCalls.toLocaleString()} {a.unit}
                            </span>
                          )}
                        </p>
                      </div>
                      <p className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {formatUsd(stats.cost)}
                      </p>
                      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary/60"
                          style={{ width: `${Math.max(pct, pct > 0 ? 1 : 0)}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground tabular-nums text-right">
                        {pct.toFixed(0)}%
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>By Model</CardTitle>
          </CardHeader>
          <CardContent>
            {modelRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No usage this month</p>
            ) : (
              <div className="space-y-2">
                {modelRows.map((row) => {
                  const pct = totalCost > 0 ? (row.cost / totalCost) * 100 : 0;
                  return (
                    <div key={row.model} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {row.label}
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {row.calls.toLocaleString()} calls
                          </span>
                        </p>
                      </div>
                      <p className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {formatUsd(row.cost)}
                      </p>
                      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary/60"
                          style={{ width: `${Math.max(pct, pct > 0 ? 1 : 0)}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground tabular-nums text-right">
                        {pct.toFixed(0)}%
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Daily breakdown */}
      <Card size="sm">
        <CardHeader>
          <CardTitle>Daily Spend</CardTitle>
        </CardHeader>
        <CardContent>
          {dailyData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No usage this month</p>
          ) : (
            <div className="space-y-1.5">
              {dailyData.map((d) => (
                <div key={d.date} className="flex items-center gap-3 text-sm">
                  <span className="w-12 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {d.date.slice(5)}
                  </span>
                  <div className="flex-1">
                    <div
                      className="h-4 rounded bg-primary/20"
                      style={{
                        width: `${Math.max((d.cost / maxDailyCost) * 100, d.cost > 0 ? 1 : 0)}%`,
                      }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums">
                    {formatUsd(d.cost)}
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
