import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IconClock, IconGitCommit, IconMicroscope } from "@tabler/icons-react";

export interface AnalysisHistoryItem {
  id: string;
  repoName: string;
  repoUrl: string;
  commitHash?: string;
  status: string;
  totalPackages: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  durationMs?: number;
  createdAt: string;
  userName: string;
  deepDiveCount?: number;
}

interface AnalysisHistoryProps {
  items: AnalysisHistoryItem[];
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function AnalysisHistory({ items }: AnalysisHistoryProps) {
  if (items.length === 0) {
    return (
      <div className="text-muted-foreground py-8 text-center text-sm">
        No analyses yet. Paste a GitHub URL above to get started.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Recent Analyses</h3>
      {items.map((item) => (
        <a key={item.id} href={`/package-analyzer/${item.id}`} className="block">
          <Card className="transition-colors hover:bg-muted/50">
            <CardContent className="flex items-center justify-between py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-sm">{item.repoName}</span>
                  {item.status === "failed" && <Badge variant="destructive">Failed</Badge>}
                  {item.status === "running" && <Badge variant="secondary">Running</Badge>}
                </div>
                <div className="text-muted-foreground mt-0.5 flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1">
                    <IconClock className="h-3 w-3" />
                    {timeAgo(item.createdAt)}
                  </span>
                  {item.commitHash && (
                    <span className="flex items-center gap-1">
                      <IconGitCommit className="h-3 w-3" />
                      {item.commitHash.slice(0, 7)}
                    </span>
                  )}
                  <span>{item.userName}</span>
                </div>
              </div>
              {item.status === "completed" && (
                <div className="flex items-center gap-2 text-xs">
                  {item.criticalCount > 0 && <span className="font-semibold text-red-600 dark:text-red-400">🔴 {item.criticalCount}</span>}
                  {item.highCount > 0 && <span className="font-semibold text-orange-600 dark:text-orange-400">🟠 {item.highCount}</span>}
                  {item.mediumCount > 0 && <span className="text-yellow-600 dark:text-yellow-400">🟡 {item.mediumCount}</span>}
                  {item.criticalCount === 0 && item.highCount === 0 && item.mediumCount === 0 && (
                    <span className="text-green-600 dark:text-green-400">✅ Clean</span>
                  )}
                  {item.deepDiveCount ? (
                    <span className="flex items-center gap-0.5 text-purple-600 dark:text-purple-400">
                      <IconMicroscope className="h-3 w-3" />
                      {item.deepDiveCount}
                    </span>
                  ) : null}
                  <span className="text-muted-foreground">{item.totalPackages} pkg{item.totalPackages !== 1 ? "s" : ""}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </a>
      ))}
    </div>
  );
}
