import type { DependencyRiskReport } from "@octopus/package-analyzer";
import { RiskCard } from "./risk-card";

interface ResultsListProps {
  reports: DependencyRiskReport[];
  authenticated?: boolean;
  analysisId?: string;
  safePackages?: Set<string>;
}

export function ResultsList({ reports, authenticated, analysisId, safePackages }: ResultsListProps) {
  if (reports.length === 0) {
    return (
      <div className="text-muted-foreground py-12 text-center">
        <p className="text-lg">No dependencies found to analyze.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reports.map((report) => (
        <RiskCard
          key={`${report.file}:${report.package}`}
          report={report}
          authenticated={authenticated}
          analysisId={analysisId}
          markedSafe={safePackages?.has(report.package)}
        />
      ))}
    </div>
  );
}
