"use client";

import { Badge } from "@/components/ui/badge";
import { IconAlertTriangle, IconShieldCheck, IconEye, IconInfoCircle } from "@tabler/icons-react";

export interface DeepDiveFinding {
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  file?: string;
  evidence?: string;
}

export interface DeepDiveAnalysis {
  verdict: "malicious" | "suspicious" | "likely_safe" | "safe";
  confidence: "high" | "medium" | "low";
  summary: string;
  findings: DeepDiveFinding[];
  recommendation: string;
}

const VERDICT_CONFIG = {
  malicious: { label: "MALICIOUS", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", icon: IconAlertTriangle },
  suspicious: { label: "SUSPICIOUS", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200", icon: IconEye },
  likely_safe: { label: "LIKELY SAFE", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200", icon: IconInfoCircle },
  safe: { label: "SAFE", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", icon: IconShieldCheck },
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-red-600 dark:text-red-400",
  high: "text-orange-600 dark:text-orange-400",
  medium: "text-yellow-600 dark:text-yellow-400",
  low: "text-blue-600 dark:text-blue-400",
};

interface DeepDiveResultProps {
  analysis: DeepDiveAnalysis;
  packageInfo: { name: string; version: string; filesAnalyzed: number; totalSize: number };
}

export function DeepDiveResult({ analysis, packageInfo }: DeepDiveResultProps) {
  const verdict = VERDICT_CONFIG[analysis.verdict] ?? VERDICT_CONFIG.suspicious;
  const VerdictIcon = verdict.icon;

  return (
    <div className="mt-4 space-y-3 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <VerdictIcon className="h-5 w-5" />
          <span className={`rounded px-2 py-0.5 text-xs font-bold ${verdict.color}`}>
            {verdict.label}
          </span>
          <span className="text-muted-foreground text-xs">
            Confidence: {analysis.confidence}
          </span>
        </div>
        <span className="text-muted-foreground text-xs">
          {packageInfo.filesAnalyzed} files analyzed ({(packageInfo.totalSize / 1024).toFixed(1)}KB)
        </span>
      </div>

      <p className="text-sm">{analysis.summary}</p>

      {analysis.findings.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Findings</h4>
          {analysis.findings.map((f, i) => (
            <div key={i} className="rounded border bg-background p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold uppercase ${SEVERITY_COLOR[f.severity] ?? ""}`}>
                  {f.severity}
                </span>
                <span className="font-medium">{f.title}</span>
                {f.file && <span className="text-muted-foreground text-xs">({f.file})</span>}
              </div>
              <p className="text-muted-foreground mt-1">{f.description}</p>
              {f.evidence && (
                <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">
                  <code>{f.evidence}</code>
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="rounded border-l-2 border-blue-400 bg-blue-50 p-3 text-sm dark:bg-blue-950">
        <span className="font-medium">Recommendation: </span>
        {analysis.recommendation}
      </div>
    </div>
  );
}
