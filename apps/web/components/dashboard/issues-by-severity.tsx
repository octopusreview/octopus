"use client";

import Link from "@/components/link";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { IconAlertTriangle } from "@tabler/icons-react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";
import { ChartTooltip } from "./chart-tooltip";

interface SeverityData {
  severity: string;
  count: number;
  color: string;
}

interface IssuesBySeverityCardProps {
  data: SeverityData[];
  total: number;
}

const SEVERITY_LABELS: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function IssuesBySeverityCard({ data, total }: IssuesBySeverityCardProps) {
  if (total === 0) {
    return (
      <Card className="flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <IconAlertTriangle className="size-3.5" />
              Issues by Severity
            </div>
            <Link href="/issues" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              See all &rarr;
            </Link>
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col items-center justify-center py-8">
          <IconAlertTriangle className="mb-2 size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No issues found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <IconAlertTriangle className="size-3.5" />
            Issues by Severity
          </div>
          <Link href="/issues" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            See all &rarr;
          </Link>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <div className="relative flex-1">
          <ResponsiveContainer width="100%" height={140}>
            <PieChart>
              <Pie
                data={data}
                dataKey="count"
                nameKey="severity"
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={60}
                strokeWidth={2}
                stroke="var(--color-card)"
              >
                {data.map((entry) => (
                  <Cell key={entry.severity} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                content={
                  <ChartTooltip
                    formatter={(value, name) => [
                      value ?? 0,
                      SEVERITY_LABELS[name ?? ""] ?? name ?? "",
                    ]}
                  />
                }
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="text-2xl font-bold">{total}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Total
              </div>
            </div>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-center gap-4">
          {data.map((entry) => (
            <div key={entry.severity} className="flex items-center gap-1.5">
              <div
                className="size-2.5 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                {SEVERITY_LABELS[entry.severity] ?? entry.severity} ({entry.count})
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
