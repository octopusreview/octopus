"use client";

import { Fragment, useState, useTransition, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  IconBrandGithub,
  IconBrandBitbucket,
  IconGitBranch,
  IconExternalLink,
  IconDatabaseImport,
  IconLoader2,
  IconCircleCheck,
  IconAlertTriangle,
  IconChevronDown,
  IconChevronUp,
  IconFileCode,
  IconVectorTriangle,
  IconPuzzle,
  IconClock,
  IconCalendar,
  IconRefresh,
  IconGitPullRequest,
  IconX,
} from "@tabler/icons-react";
import { indexRepository, cancelIndexing } from "@/app/(app)/actions";
import { IndexingLogs } from "@/components/indexing-logs";
import { getPubbyClient } from "@/lib/pubby-client";

type PullRequestItem = {
  id: string;
  number: number;
  title: string;
  url: string;
  author: string;
  status: string;
  createdAt: string;
};

type Repo = {
  id: string;
  name: string;
  fullName: string;
  provider: string;
  defaultBranch: string;
  isActive: boolean;
  indexStatus: string;
  indexedAt: string | null;
  indexedFiles: number;
  totalFiles: number;
  totalChunks: number;
  totalVectors: number;
  indexDurationMs: number | null;
  summary: string | null;
  purpose: string | null;
  pullRequests: PullRequestItem[];
};

const providerConfig: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; repoUrl: (fullName: string) => string }
> = {
  github: {
    icon: IconBrandGithub,
    repoUrl: (fullName) => `https://github.com/${fullName}`,
  },
  bitbucket: {
    icon: IconBrandBitbucket,
    repoUrl: (fullName) => `https://bitbucket.org/${fullName}`,
  },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function IndexBadge({
  status,
  repoId,
  indexedAt: _indexedAt,
  needsAccess,
  githubAppSlug,
  onIndexStart,
}: {
  status: string;
  repoId: string;
  indexedAt: string | null;
  needsAccess: boolean;
  githubAppSlug: string | null;
  onIndexStart: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [cancelPending, startCancelTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleIndex = async () => {
    setError(null);
    onIndexStart();
    startTransition(async () => {
      const result = await indexRepository(repoId);
      if (result.error) {
        setError(result.error);
      }
    });
  };

  const handleCancel = () => {
    startCancelTransition(async () => {
      await cancelIndexing(repoId);
    });
  };

  if (status === "indexing" || (pending && !error)) {
    return (
      <div className="flex items-center gap-1.5">
        <Badge variant="secondary">
          <IconLoader2 className="mr-1 size-3 animate-spin" />
          Indexing…
        </Badge>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs text-destructive hover:text-destructive"
          onClick={handleCancel}
          disabled={cancelPending}
        >
          {cancelPending ? (
            <IconLoader2 className="mr-1 size-3 animate-spin" />
          ) : (
            <IconX className="mr-1 size-3" />
          )}
          Cancel
        </Button>
      </div>
    );
  }

  if (status === "indexed") {
    return (
      <div className="flex items-center gap-1.5">
        <Badge variant="default" className="bg-emerald-600">
          <IconCircleCheck className="mr-1 size-3" />
          Indexed
        </Badge>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={handleIndex}
        >
          <IconRefresh className="mr-1 size-3" />
          Re-index
        </Button>
        {error && (
          <span className="text-xs text-destructive">{error}</span>
        )}
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="flex items-center gap-1.5">
        <Badge variant="destructive">
          <IconAlertTriangle className="mr-1 size-3" />
          Failed
        </Badge>
        {needsAccess && githubAppSlug ? (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            asChild
          >
            <a
              href={`https://github.com/apps/${githubAppSlug}/installations/new?state=${encodeURIComponent(`${window.location.origin}/dashboard`)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <IconExternalLink className="mr-1 size-3" />
              Grant Access
            </a>
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={handleIndex}
          >
            Retry
          </Button>
        )}
      </div>
    );
  }

  // pending status
  return (
    <Button
      size="sm"
      variant="cta"
      className="h-7 text-xs"
      onClick={handleIndex}
    >
      <IconDatabaseImport className="mr-1 size-3" />
      Create Index
    </Button>
  );
}

function IndexStats({ repo }: { repo: Repo }) {
  if (repo.indexStatus !== "indexed" || !repo.indexedAt) return null;

  return (
    <div className="mt-3 space-y-3">
      {repo.purpose && (
        <div className="rounded-md border bg-muted/30 px-3 py-2">
          <div className="text-[10px] font-medium text-muted-foreground">Purpose</div>
          <div className="mt-0.5 text-sm font-medium">{repo.purpose}</div>
        </div>
      )}
      {repo.summary && (
        <div className="rounded-md border bg-muted/30 px-3 py-2">
          <div className="text-[10px] font-medium text-muted-foreground">Summary</div>
          <div className="mt-0.5 text-sm text-muted-foreground">{repo.summary}</div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div className="rounded-md border bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
            <IconFileCode className="size-3" />
            Files
          </div>
          <div className="mt-0.5 text-sm font-semibold">
            {repo.indexedFiles}
            <span className="text-muted-foreground font-normal">/{repo.totalFiles}</span>
          </div>
        </div>
        <div className="rounded-md border bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
            <IconPuzzle className="size-3" />
            Chunks
          </div>
          <div className="mt-0.5 text-sm font-semibold">{repo.totalChunks}</div>
        </div>
        <div className="rounded-md border bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
            <IconVectorTriangle className="size-3" />
            Vectors
          </div>
          <div className="mt-0.5 text-sm font-semibold">{repo.totalVectors}</div>
        </div>
        <div className="rounded-md border bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
            <IconClock className="size-3" />
            Duration
          </div>
          <div className="mt-0.5 text-sm font-semibold">
            {repo.indexDurationMs ? formatDuration(repo.indexDurationMs) : "—"}
          </div>
        </div>
        <div className="rounded-md border bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
            <IconCalendar className="size-3" />
            Indexed
          </div>
          <div className="mt-0.5 text-sm font-semibold">
            {formatDate(repo.indexedAt)}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="secondary" className="text-[10px]">
          <IconClock className="mr-1 size-3" />
          Pending
        </Badge>
      );
    case "reviewing":
      return (
        <Badge variant="secondary" className="text-[10px]">
          <IconLoader2 className="mr-1 size-3 animate-spin" />
          Reviewing
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="default" className="bg-emerald-600 text-[10px]">
          <IconCircleCheck className="mr-1 size-3" />
          Completed
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="text-[10px]">
          <IconAlertTriangle className="mr-1 size-3" />
          Failed
        </Badge>
      );
    default:
      return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
  }
}

function PullRequestList({ pullRequests }: { pullRequests: PullRequestItem[] }) {
  if (pullRequests.length === 0) return null;

  return (
    <div className="mt-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground mb-2">
        <IconGitPullRequest className="size-3" />
        Pull Requests ({pullRequests.length})
      </div>
      <div className="space-y-1.5">
        {pullRequests.map((pr) => (
          <div
            key={pr.id}
            className="flex flex-col gap-1.5 rounded-md border bg-muted/30 px-3 py-2 sm:flex-row sm:items-center sm:gap-2"
          >
            <a
              href={pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium hover:underline"
            >
              <span className="shrink-0 text-muted-foreground">#{pr.number}</span>
              <span className="truncate">{pr.title}</span>
              <IconExternalLink className="size-3 shrink-0 text-muted-foreground" />
            </a>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">{pr.author}</span>
              <ReviewStatusBadge status={pr.status} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RepoTable({
  repos,
  orgId,
  githubAppSlug,
}: {
  repos: Repo[];
  orgId: string;
  githubAppSlug: string | null;
}) {
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, string>>(() =>
    Object.fromEntries(repos.map((r) => [r.id, r.indexStatus])),
  );
  const [accessErrors, setAccessErrors] = useState<Record<string, boolean>>({});
  const [pullRequests, setPullRequests] = useState<Record<string, PullRequestItem[]>>(() =>
    Object.fromEntries(repos.map((r) => [r.id, r.pullRequests])),
  );

  // Listen to real-time status updates
  useEffect(() => {
    const pubby = getPubbyClient();
    const channel = pubby.subscribe(`presence-org-${orgId}`);

    const handleStatus = (raw: unknown) => {
      const data = raw as { repoId: string; status: string; needsAccess?: boolean };
      const resolvedStatus = data.status === "cancelled" ? "pending" : data.status;
      setStatuses((prev) => ({ ...prev, [data.repoId]: resolvedStatus }));
      if (data.needsAccess) {
        setAccessErrors((prev) => ({ ...prev, [data.repoId]: true }));
      }
    };

    const handleReviewRequested = (raw: unknown) => {
      const data = raw as {
        repoId: string;
        pullRequest: PullRequestItem;
      };
      setPullRequests((prev) => {
        const existing = prev[data.repoId] ?? [];
        const filtered = existing.filter((pr) => pr.number !== data.pullRequest.number);
        return { ...prev, [data.repoId]: [data.pullRequest, ...filtered] };
      });
    };

    const handleReviewStatus = (raw: unknown) => {
      const data = raw as {
        repoId: string;
        pullRequestId: string;
        number: number;
        status: string;
        step: string;
      };
      setPullRequests((prev) => {
        const existing = prev[data.repoId] ?? [];
        return {
          ...prev,
          [data.repoId]: existing.map((pr) =>
            pr.number === data.number ? { ...pr, status: data.status } : pr,
          ),
        };
      });
    };

    channel.bind("index-status", handleStatus);
    channel.bind("review-requested", handleReviewRequested);
    channel.bind("review-status", handleReviewStatus);

    return () => {
      channel.unbind("index-status", handleStatus);
      channel.unbind("review-requested", handleReviewRequested);
      channel.unbind("review-status", handleReviewStatus);
    };
  }, [orgId]);

  const handleIndexStart = (repoId: string) => {
    setStatuses((prev) => ({ ...prev, [repoId]: "indexing" }));
    setAccessErrors((prev) => ({ ...prev, [repoId]: false }));
    setExpandedRepo(repoId);
  };

  const toggleExpand = (repoId: string) => {
    setExpandedRepo((prev) => (prev === repoId ? null : repoId));
  };

  if (repos.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <IconGitBranch className="text-muted-foreground mb-3 size-10" />
          <p className="text-muted-foreground text-sm">
            No repositories yet — connect GitHub to get started.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Desktop table */}
      <div className="mt-4 hidden overflow-hidden rounded-md border sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="w-[300px] px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">Repository</th>
              <th className="w-[250px] px-4 py-3 text-left font-medium">Status</th>
              <th className="w-10 px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {repos.map((repo) => {
              const provider = providerConfig[repo.provider];
              const ProviderIcon = provider?.icon ?? IconGitBranch;
              const repoUrl = provider?.repoUrl(repo.fullName);
              const status = statuses[repo.id] ?? repo.indexStatus;
              const repoPrs = pullRequests[repo.id] ?? [];
              const isExpanded = expandedRepo === repo.id;
              const canExpand = status !== "pending" || repoPrs.length > 0;

              return (
                <Fragment key={repo.id}>
                  <tr
                    className={`border-b last:border-b-0 ${canExpand ? "cursor-pointer hover:bg-muted/30" : ""}`}
                    onClick={canExpand ? () => toggleExpand(repo.id) : undefined}
                  >
                    <td className="w-[300px] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <ProviderIcon className="text-muted-foreground size-4 shrink-0" />
                        <a
                          href={`/repositories?repo=${repo.id}`}
                          className="font-medium hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {repo.name}
                        </a>
                        {repoPrs.length > 0 && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            <IconGitPullRequest className="mr-0.5 size-3" />
                            {repoPrs.length}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {repoUrl ? (
                        <a
                          href={repoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {repo.fullName}
                          <span className="text-muted-foreground/60 text-xs">({repo.defaultBranch})</span>
                          <IconExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">
                          {repo.fullName}
                          {" "}
                          <span className="text-muted-foreground/60 text-xs">({repo.defaultBranch})</span>
                        </span>
                      )}
                    </td>
                    <td className="w-[250px] px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <IndexBadge
                        status={status}
                        repoId={repo.id}
                        indexedAt={repo.indexedAt}
                        needsAccess={accessErrors[repo.id] ?? false}
                        githubAppSlug={githubAppSlug}
                        onIndexStart={() => handleIndexStart(repo.id)}
                      />
                    </td>
                    <td className="w-10 px-2 py-3">
                      {canExpand && (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(repo.id);
                          }}
                        >
                          {isExpanded ? (
                            <IconChevronUp className="size-3.5" />
                          ) : (
                            <IconChevronDown className="size-3.5" />
                          )}
                        </Button>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-b last:border-b-0">
                      <td colSpan={4} className="px-4 pb-3 pt-0">
                        <IndexStats repo={{ ...repo, indexStatus: status }} />
                        {(status === "indexing" || status === "failed") && (
                          <IndexingLogs
                            repoId={repo.id}
                            orgId={orgId}
                            initialStatus={status}
                          />
                        )}
                        <PullRequestList pullRequests={repoPrs} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="mt-4 space-y-3 sm:hidden">
        {repos.map((repo) => {
          const provider = providerConfig[repo.provider];
          const ProviderIcon = provider?.icon ?? IconGitBranch;
          const repoUrl = provider?.repoUrl(repo.fullName);
          const status = statuses[repo.id] ?? repo.indexStatus;
          const repoPrs = pullRequests[repo.id] ?? [];
          const isExpanded = expandedRepo === repo.id;
          const canExpand = status !== "pending" || repoPrs.length > 0;

          return (
            <Card
              key={repo.id}
              className={`overflow-hidden p-3 ${canExpand ? "cursor-pointer" : ""}`}
              onClick={canExpand ? () => toggleExpand(repo.id) : undefined}
            >
              <div className="flex min-w-0 items-center gap-2">
                <ProviderIcon className="text-muted-foreground size-4 shrink-0" />
                <a
                  href={`/repositories?repo=${repo.id}`}
                  className="min-w-0 truncate text-sm font-medium hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {repo.name}
                </a>
                {repoPrs.length > 0 && (
                  <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0">
                    <IconGitPullRequest className="mr-0.5 size-3" />
                    {repoPrs.length}
                  </Badge>
                )}
                {canExpand && (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="ml-auto shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(repo.id);
                    }}
                  >
                    {isExpanded ? (
                      <IconChevronUp className="size-3.5" />
                    ) : (
                      <IconChevronDown className="size-3.5" />
                    )}
                  </Button>
                )}
              </div>
              <div className="mt-2 flex min-w-0 flex-col gap-2">
                {repoUrl ? (
                  <a
                    href={repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground inline-flex min-w-0 items-center gap-1 text-xs transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="truncate">{repo.fullName}</span>
                    <span className="shrink-0 text-muted-foreground/60">({repo.defaultBranch})</span>
                    <IconExternalLink className="size-3 shrink-0" />
                  </a>
                ) : (
                  <span className="text-muted-foreground truncate text-xs">
                    {repo.fullName}
                    {" "}
                    <span className="text-muted-foreground/60">({repo.defaultBranch})</span>
                  </span>
                )}
                <span onClick={(e) => e.stopPropagation()}>
                  <IndexBadge
                    status={status}
                    repoId={repo.id}
                    indexedAt={repo.indexedAt}
                    needsAccess={accessErrors[repo.id] ?? false}
                    githubAppSlug={githubAppSlug}
                    onIndexStart={() => handleIndexStart(repo.id)}
                  />
                </span>
              </div>
              {isExpanded && (
                <div onClick={(e) => e.stopPropagation()}>
                  <IndexStats repo={{ ...repo, indexStatus: status }} />
                  {(status === "indexing" || status === "failed") && (
                    <IndexingLogs
                      repoId={repo.id}
                      orgId={orgId}
                      initialStatus={status}
                    />
                  )}
                  <PullRequestList pullRequests={repoPrs} />
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
