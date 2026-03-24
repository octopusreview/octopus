"use client";

import { useState } from "react";
import type { DependencyRiskReport, RiskLevel } from "@octopus/package-analyzer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IconShieldCheck, IconMicroscope, IconLoader2, IconShield } from "@tabler/icons-react";
import { DeepDiveResult, type DeepDiveAnalysis } from "./deep-dive-result";

const RISK_CONFIG: Record<
  RiskLevel,
  { emoji: string; badgeVariant: "default" | "secondary" | "destructive" | "outline" }
> = {
  critical: { emoji: "🔴", badgeVariant: "destructive" },
  high: { emoji: "🟠", badgeVariant: "destructive" },
  medium: { emoji: "🟡", badgeVariant: "secondary" },
  low: { emoji: "🔵", badgeVariant: "outline" },
  clean: { emoji: "✅", badgeVariant: "outline" },
};

interface RiskCardProps {
  report: DependencyRiskReport;
  authenticated?: boolean;
  analysisId?: string;
  markedSafe?: boolean;
}

export function RiskCard({ report, authenticated, analysisId, markedSafe }: RiskCardProps) {
  const config = RISK_CONFIG[report.overallRisk];
  const [deepDive, setDeepDive] = useState<DeepDiveAnalysis | null>(null);
  const [deepDiveLoading, setDeepDiveLoading] = useState(false);
  const [deepDiveError, setDeepDiveError] = useState<string | null>(null);
  const [packageInfo, setPackageInfo] = useState<{ name: string; version: string; filesAnalyzed: number; totalSize: number } | null>(null);
  const [markSafeLoading, setMarkSafeLoading] = useState(false);
  const [markSafeResult, setMarkSafeResult] = useState<string | null>(null);
  const [markSafeReason, setMarkSafeReason] = useState("");
  const [showMarkSafeForm, setShowMarkSafeForm] = useState(false);

  const showDeepDive = authenticated && report.overallRisk !== "clean" && !report.isSecurityHolding;
  const showMarkSafe = authenticated && report.overallRisk !== "clean" && !report.isSecurityHolding && !markedSafe;

  const handleMarkSafe = async () => {
    if (!markSafeReason.trim()) return;
    setMarkSafeLoading(true);
    try {
      const resp = await fetch("/api/analyze-deps/mark-safe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageName: report.package,
          version: report.version,
          reason: markSafeReason.trim(),
        }),
      });
      const data = await resp.json();
      setMarkSafeResult(data.message ?? "Request submitted");
      setShowMarkSafeForm(false);
    } catch {
      setMarkSafeResult("Failed to submit request");
    } finally {
      setMarkSafeLoading(false);
    }
  };

  const handleDeepDive = async () => {
    setDeepDiveLoading(true);
    setDeepDiveError(null);

    try {
      const resp = await fetch("/api/analyze-deps/deep-dive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageName: report.package,
          version: report.version.replace(/^[\^~>=<]/, ""),
          analysisId,
        }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({ error: "Deep dive failed" }));
        setDeepDiveError(data.error ?? "Deep dive failed");
        return;
      }

      const data = await resp.json();
      setDeepDive(data.analysis);
      setPackageInfo(data.packageInfo);
    } catch (err) {
      setDeepDiveError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setDeepDiveLoading(false);
    }
  };

  return (
    <Card className={markedSafe ? "border-green-200 dark:border-green-800 opacity-75" : (report.overallRisk === "critical" || report.overallRisk === "high") ? "border-red-200 dark:border-red-800" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <span>{markedSafe ? "✅" : config.emoji}</span>
            <code className="text-sm font-semibold">{report.package}@{report.version}</code>
          </CardTitle>
          <div className="flex items-center gap-2">
            {markedSafe && (
              <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950 dark:text-green-400">
                <IconShieldCheck className="mr-1 h-3 w-3" />
                Safe
              </Badge>
            )}
            <Badge variant={markedSafe ? "outline" : config.badgeVariant} className={markedSafe ? "line-through opacity-50" : ""}>
              {report.overallRisk.toUpperCase()}
            </Badge>
            <span className="text-muted-foreground text-xs">Score: {report.totalScore}</span>
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          {report.file}
          {report.isDevDependency && <span className="ml-2 opacity-70">(devDependency)</span>}
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {markedSafe ? (
          <p className="text-sm text-green-700 dark:text-green-400">
            This package has been reviewed and marked as safe by an admin. The original analysis flagged it due to automated heuristics, but it has been verified as a legitimate package.
          </p>
        ) : (
          <>
            {report.signals.length > 0 && (
              <ul className="space-y-1.5">
                {report.signals.map((signal, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 text-amber-500">⚠️</span>
                    <span>
                      <span className="text-muted-foreground font-medium">[{signal.source}]</span>{" "}
                      {signal.description}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {report.recommendation && (
              <p className="text-muted-foreground mt-3 text-sm italic">
                {report.recommendation}
              </p>
            )}
          </>
        )}

        {report.isSecurityHolding && (
          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm dark:border-red-800 dark:bg-red-950">
            <p className="font-semibold text-red-700 dark:text-red-400">
              This package was confirmed malicious and removed by the npm security team.
            </p>
            <p className="text-muted-foreground mt-1">
              A security holding placeholder has been published to prevent future installations.
              Source code analysis is not available because the original malicious code was removed.
            </p>
          </div>
        )}

        {(showDeepDive || showMarkSafe) && (
          <div className="mt-4 space-y-2">
            <div className="flex gap-2">
              {showDeepDive && !deepDive && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDeepDive}
                  disabled={deepDiveLoading}
                >
                  {deepDiveLoading ? (
                    <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <IconMicroscope className="mr-2 h-4 w-4" />
                  )}
                  {deepDiveLoading ? "Analyzing source code..." : "Deep Dive"}
                </Button>
              )}
              {showMarkSafe && !markSafeResult && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowMarkSafeForm(!showMarkSafeForm)}
                >
                  <IconShield className="mr-2 h-4 w-4" />
                  Mark as Safe
                </Button>
              )}
            </div>
            {deepDiveError && (
              <p className="text-xs text-red-500">{deepDiveError}</p>
            )}
            {showMarkSafeForm && !markSafeResult && (
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
                  placeholder="Why is this package safe?"
                  value={markSafeReason}
                  onChange={(e) => setMarkSafeReason(e.target.value)}
                />
                <Button size="sm" onClick={handleMarkSafe} disabled={!markSafeReason.trim() || markSafeLoading}>
                  {markSafeLoading ? <IconLoader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                  Submit
                </Button>
              </div>
            )}
            {markSafeResult && (
              <p className="text-xs text-green-600 dark:text-green-400">{markSafeResult}</p>
            )}
          </div>
        )}

        {deepDive && packageInfo && (
          <DeepDiveResult analysis={deepDive} packageInfo={packageInfo} />
        )}
      </CardContent>
    </Card>
  );
}
