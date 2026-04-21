"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  IconAlertTriangle,
  IconFileCode,
  IconCheck,
  IconBug,
  IconCalendar,
  IconFilter,
  IconExternalLink,
  IconGitFork,
} from "@tabler/icons-react";
import { CreateLinearIssueButton } from "@/components/create-linear-issue-dialog";
import { CreateJiraIssueButton } from "@/components/create-jira-issue-dialog";
import { CreateGitHubIssueButton } from "@/components/create-github-issue-dialog";
import { FeedbackButtons } from "@/components/issues/feedback-buttons";
import { acknowledgeIssue } from "@/app/(app)/actions";

type Issue = {
  id: string;
  title: string;
  description: string;
  severity: string;
  filePath: string | null;
  lineNumber: number | null;
  acknowledged: boolean;
  createdAt: string;
  linearIssueId: string | null;
  linearIssueUrl: string | null;
  jiraIssueKey: string | null;
  jiraIssueUrl: string | null;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  feedback: "up" | "down" | null;
  repoFullName: string;
  repoProvider: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
};

interface IssuesContentProps {
  issues: Issue[];
  kpiCounts: { critical: number; high: number; medium: number; low: number };
  currentSeverity: string;
  currentPeriod: string;
  currentStatus: string;
  linearConnected: boolean;
  jiraConnected: boolean;
  githubConnected: boolean;
}

const severityOptions = [
  { value: "all", label: "All severities" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const periodOptions = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

const statusOptions = [
  { value: "open", label: "Open" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "all", label: "All" },
];

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-700/10 text-red-700 border-red-700/20",
  high: "bg-red-500/10 text-red-500 border-red-500/20",
  medium: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  low: "bg-muted text-muted-foreground border-border",
};

function AcknowledgeButton({ issueId }: { issueId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 shrink-0 px-2 text-[10px] text-muted-foreground hover:text-foreground"
          disabled={isPending}
        >
          <IconCheck className="mr-0.5 size-3" />
          {isPending ? "..." : "Acknowledge"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Acknowledge this issue?</AlertDialogTitle>
          <AlertDialogDescription>
            This will mark the issue as acknowledged. You can still find it using the status filter.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              startTransition(async () => {
                await acknowledgeIssue(issueId);
              });
            }}
          >
            Acknowledge
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function IssuesContent({
  issues,
  kpiCounts,
  currentSeverity,
  currentPeriod,
  currentStatus,
  linearConnected,
  jiraConnected,
  githubConnected,
}: IssuesContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === "all" && key !== "status") {
        params.delete(key);
      } else if (value === "open" && key === "status") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      const qs = params.toString();
      router.push(qs ? `/issues?${qs}` : "/issues");
    },
    [router, searchParams]
  );

  const total = kpiCounts.high + kpiCounts.medium + kpiCounts.low;

  // Group issues by repository
  const groupedByRepo = issues.reduce<Record<string, Issue[]>>((acc, issue) => {
    const key = issue.repoFullName;
    if (!acc[key]) acc[key] = [];
    acc[key].push(issue);
    return acc;
  }, {});

  const repoNames = Object.keys(groupedByRepo).sort();

  return (
    <>
      {/* KPI Cards */}
      <div className="mt-6 grid grid-cols-4 gap-3">
        <Card className="p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground sm:text-sm">Critical</span>
            <div className="size-2.5 rounded-full bg-red-700" />
          </div>
          <div className="mt-1 text-2xl font-bold sm:text-3xl">{kpiCounts.critical}</div>
        </Card>
        <Card className="p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground sm:text-sm">High</span>
            <div className="size-2.5 rounded-full bg-red-500" />
          </div>
          <div className="mt-1 text-2xl font-bold sm:text-3xl">{kpiCounts.high}</div>
        </Card>
        <Card className="p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground sm:text-sm">Medium</span>
            <div className="size-2.5 rounded-full bg-amber-500" />
          </div>
          <div className="mt-1 text-2xl font-bold sm:text-3xl">{kpiCounts.medium}</div>
        </Card>
        <Card className="p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground sm:text-sm">Low</span>
            <div className="size-2.5 rounded-full bg-muted-foreground/40" />
          </div>
          <div className="mt-1 text-2xl font-bold sm:text-3xl">{kpiCounts.low}</div>
        </Card>
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div>
          <span className="text-sm font-medium text-muted-foreground">{total} issues</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Select value={currentSeverity} onValueChange={(v) => updateFilter("severity", v)}>
            <SelectTrigger size="sm" className="h-8 text-xs">
              <IconFilter className="mr-1.5 size-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {severityOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={currentPeriod} onValueChange={(v) => updateFilter("period", v)}>
            <SelectTrigger size="sm" className="h-8 text-xs">
              <IconCalendar className="mr-1.5 size-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periodOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={currentStatus} onValueChange={(v) => updateFilter("status", v)}>
            <SelectTrigger size="sm" className="h-8 text-xs">
              <IconCheck className="mr-1.5 size-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Issue List — grouped by repository */}
      <div className="mt-4 space-y-6">
        {issues.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16">
            <IconBug className="mb-3 size-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">No issues found</p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Try adjusting your filters
            </p>
          </div>
        ) : (
          repoNames.map((repoName) => {
            const repoIssues = groupedByRepo[repoName];
            const firstIssue = repoIssues[0];
            const repoHref = firstIssue.repoProvider === "github"
              ? `https://github.com/${repoName}`
              : `https://bitbucket.org/${repoName}`;

            return (
              <div key={repoName}>
                <div className="mb-2 flex items-center gap-2">
                  <IconGitFork className="size-4 text-muted-foreground" />
                  <a
                    href={repoHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold text-foreground/80 hover:text-foreground transition-colors"
                  >
                    {repoName}
                  </a>
                  <span className="text-xs text-muted-foreground">
                    {repoIssues.length} issue{repoIssues.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="space-y-2">
                  {repoIssues.map((issue) => (
                    <div
                      key={issue.id}
                      className="space-y-1.5 rounded-md border px-4 py-3"
                    >
                      <div className="flex items-start gap-2">
                        <IconAlertTriangle
                          className={`mt-0.5 size-3.5 shrink-0 ${
                            issue.severity === "critical"
                              ? "text-red-700"
                              : issue.severity === "high"
                                ? "text-red-500"
                                : issue.severity === "medium"
                                  ? "text-amber-500"
                                  : "text-muted-foreground"
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium leading-tight">
                              {issue.title}
                            </span>
                            <Badge
                              variant="outline"
                              className={`shrink-0 text-[10px] px-1.5 py-0 ${SEVERITY_BADGE[issue.severity] ?? ""}`}
                            >
                              {issue.severity}
                            </Badge>
                            {issue.acknowledged && (
                              <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">
                                acknowledged
                              </Badge>
                            )}
                            <div className="ml-auto flex items-center gap-1">
                              {githubConnected && issue.repoProvider === "github" && !issue.githubIssueNumber && !issue.acknowledged && (
                                <CreateGitHubIssueButton issueId={issue.id} />
                              )}
                              {linearConnected && !issue.linearIssueId && !issue.acknowledged && (
                                <CreateLinearIssueButton issueId={issue.id} />
                              )}
                              {jiraConnected && !issue.jiraIssueKey && !issue.acknowledged && (
                                <CreateJiraIssueButton issueId={issue.id} />
                              )}
                              <FeedbackButtons issueId={issue.id} currentFeedback={issue.feedback} />
                              {!issue.acknowledged && (
                                <AcknowledgeButton issueId={issue.id} />
                              )}
                            </div>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                            {issue.description}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                            <a
                              href={issue.prUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-foreground transition-colors"
                            >
                              PR #{issue.prNumber}
                            </a>
                            {issue.filePath && (
                              <a
                                href={`${issue.prUrl}/files#diff-${issue.filePath.replace(/\//g, "-")}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                              >
                                <IconFileCode className="size-3" />
                                {issue.filePath}
                                {issue.lineNumber && `:${issue.lineNumber}`}
                              </a>
                            )}
                            <span className="text-muted-foreground/60">
                              {formatRelativeDate(issue.createdAt)}
                            </span>
                            {issue.githubIssueNumber && issue.githubIssueUrl && (
                              <a
                                href={issue.githubIssueUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-sm border border-foreground/20 bg-foreground/5 px-1.5 py-0.5 text-[10px] font-medium text-foreground/70 hover:bg-foreground/10 transition-colors"
                              >
                                #{issue.githubIssueNumber}
                                <IconExternalLink className="size-2.5" />
                              </a>
                            )}
                            {issue.linearIssueId && issue.linearIssueUrl && (
                              <a
                                href={issue.linearIssueUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-sm border border-[#5E6AD2]/30 bg-[#5E6AD2]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#5E6AD2] hover:bg-[#5E6AD2]/20 transition-colors"
                              >
                                Linear
                                <IconExternalLink className="size-2.5" />
                              </a>
                            )}
                            {issue.jiraIssueKey && issue.jiraIssueUrl && (
                              <a
                                href={issue.jiraIssueUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-sm border border-[#0052CC]/30 bg-[#0052CC]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#0052CC] hover:bg-[#0052CC]/20 transition-colors"
                              >
                                {issue.jiraIssueKey}
                                <IconExternalLink className="size-2.5" />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
