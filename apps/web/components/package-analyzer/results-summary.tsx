import type { DependencyRiskReport } from "@octopus/package-analyzer";
import { Card, CardContent } from "@/components/ui/card";

interface ResultsSummaryProps {
  reports: DependencyRiskReport[];
  repoName: string;
  analyzedFiles: string[];
}

export function ResultsSummary({ reports, repoName, analyzedFiles }: ResultsSummaryProps) {
  const critical = reports.filter((r) => r.overallRisk === "critical").length;
  const high = reports.filter((r) => r.overallRisk === "high").length;
  const medium = reports.filter((r) => r.overallRisk === "medium").length;
  const low = reports.filter((r) => r.overallRisk === "low").length;
  const clean = reports.filter((r) => r.overallRisk === "clean").length;

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">{repoName}</h3>
            <p className="text-muted-foreground text-sm">
              {reports.length} package{reports.length !== 1 ? "s" : ""} analyzed across{" "}
              {analyzedFiles.length} file{analyzedFiles.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex gap-3 text-sm">
            {critical > 0 && <span className="font-semibold text-red-600 dark:text-red-400">🔴 {critical} critical</span>}
            {high > 0 && <span className="font-semibold text-orange-600 dark:text-orange-400">🟠 {high} high</span>}
            {medium > 0 && <span className="text-yellow-600 dark:text-yellow-400">🟡 {medium} medium</span>}
            {low > 0 && <span className="text-blue-600 dark:text-blue-400">🔵 {low} low</span>}
            {clean > 0 && <span className="text-green-600 dark:text-green-400">✅ {clean} clean</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
