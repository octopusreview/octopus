"use client";

import { useTransition } from "react";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import Link from "next/link";
import {
  IconMessageReport,
  IconAlertTriangle,
  IconFileCode,
  IconCheck,
  IconExternalLink,
} from "@tabler/icons-react";
import { CreateLinearIssueButton } from "@/components/create-linear-issue-dialog";
import { CreateGitHubIssueButton } from "@/components/create-github-issue-dialog";
import { FeedbackButtons } from "@/components/issues/feedback-buttons";
import { acknowledgeIssue } from "@/app/(app)/actions";

type LinearStatus = {
  state: string;
  url: string;
  identifier: string;
};

type Issue = {
  id: string;
  title: string;
  description: string;
  severity: string;
  filePath: string | null;
  lineNumber: number | null;
  linearIssueId: string | null;
  linearIssueUrl: string | null;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  feedback: "up" | "down" | null;
  repoFullName: string;
  repoProvider: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
};

function AcknowledgeButton({ issueId }: { issueId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-2 text-[10px] text-muted-foreground hover:text-foreground"
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
            This will remove the issue from your dashboard. You can still find it in the code review history.
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

export function RecentIssuesCard({
  issues = [],
  linearConnected = false,
  githubConnected = false,
  issueLinearStatuses = {},
}: {
  issues?: Issue[];
  linearConnected?: boolean;
  githubConnected?: boolean;
  issueLinearStatuses?: Record<string, LinearStatus>;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <IconMessageReport className="size-3.5" />
            Recent Issues Caught
          </div>
          <Link href="/issues" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            See all &rarr;
          </Link>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {issues.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-12">
            <IconMessageReport className="mb-2 size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No issues found
            </p>
          </div>
        ) : (
          issues.map((issue) => {
            const linearStatus = issue.linearIssueId
              ? issueLinearStatuses[issue.linearIssueId]
              : undefined;

            return (
              <div
                key={issue.id}
                className="space-y-1.5 rounded-md border px-3 py-2.5"
              >
                <div className="flex items-start gap-2">
                  <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-500" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium leading-tight line-clamp-1">
                        {issue.title}
                      </span>
                      <Badge
                        variant="outline"
                        className={`shrink-0 text-[10px] px-1.5 py-0 ${
                          issue.severity === "critical"
                            ? "border-red-900/30 bg-red-900/15 text-red-300"
                            : issue.severity === "high"
                              ? "border-red-500/20 bg-red-500/10 text-red-500"
                              : issue.severity === "medium"
                                ? "border-yellow-500/20 bg-yellow-500/10 text-yellow-500"
                                : "border-blue-500/20 bg-blue-500/10 text-blue-500"
                        }`}
                      >
                        {issue.severity}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                      {issue.description}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <a
                        href={`https://github.com/${issue.repoFullName}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-foreground/70 hover:text-foreground transition-colors"
                      >
                        {issue.repoFullName}
                      </a>
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
                          className="inline-flex min-w-0 items-center gap-1 hover:text-foreground transition-colors"
                        >
                          <IconFileCode className="size-3 shrink-0" />
                          <span className="truncate">{issue.filePath}{issue.lineNumber && `:${issue.lineNumber}`}</span>
                        </a>
                      )}
                    </div>
                    {/* Linked issue badges */}
                    {(issue.githubIssueNumber || issue.linearIssueId) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
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
                        {issue.linearIssueId && linearStatus && (
                          <a
                            href={linearStatus.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-sm border border-[#5E6AD2]/30 bg-[#5E6AD2]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#5E6AD2] hover:bg-[#5E6AD2]/20 transition-colors"
                          >
                            {linearStatus.identifier}
                            <span className="text-[#5E6AD2]/70">·</span>
                            {linearStatus.state}
                            <IconExternalLink className="size-2.5" />
                          </a>
                        )}
                        {issue.linearIssueId && !linearStatus && issue.linearIssueUrl && (
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
                        <FeedbackButtons issueId={issue.id} currentFeedback={issue.feedback} />
                      </div>
                    )}
                    {/* Action buttons — separate row so they wrap on mobile */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {githubConnected && issue.repoProvider === "github" && !issue.githubIssueNumber && (
                        <CreateGitHubIssueButton issueId={issue.id} />
                      )}
                      {linearConnected && !issue.linearIssueId && (
                        <CreateLinearIssueButton issueId={issue.id} />
                      )}
                      <AcknowledgeButton issueId={issue.id} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
