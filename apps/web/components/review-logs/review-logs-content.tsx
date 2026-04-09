"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import {
  IconSearch,
  IconCircleCheck,
  IconLoader,
  IconClock,
  IconAlertTriangle,
  IconChevronLeft,
  IconChevronRight,
  IconBrandGithub,
  IconBrandBitbucket,
  IconExternalLink,
} from "@tabler/icons-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type PullRequest = {
  id: string;
  number: number;
  title: string;
  url: string;
  author: string;
  status: string;
  repoFullName: string;
  repoProvider: string;
  issueCount: number;
  createdAt: string;
  updatedAt: string;
};

type Props = {
  pullRequests: PullRequest[];
  currentSearch: string;
  currentStatus: string;
  currentPage: number;
  totalPages: number;
  totalCount: number;
};

const statusConfig: Record<
  string,
  { label: string; icon: typeof IconCircleCheck; className: string }
> = {
  completed: {
    label: "Completed",
    icon: IconCircleCheck,
    className: "text-emerald-500",
  },
  reviewing: {
    label: "Reviewing",
    icon: IconLoader,
    className: "text-blue-500",
  },
  pending: {
    label: "Pending",
    icon: IconClock,
    className: "text-yellow-500",
  },
  failed: {
    label: "Failed",
    icon: IconAlertTriangle,
    className: "text-red-500",
  },
};

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function ProviderIcon({ provider }: { provider: string }) {
  if (provider === "bitbucket") {
    return <IconBrandBitbucket className="size-4 text-blue-500" />;
  }
  return <IconBrandGithub className="size-4 text-muted-foreground" />;
}

export function ReviewLogsContent({
  pullRequests,
  currentSearch,
  currentStatus,
  currentPage,
  totalPages,
  totalCount,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [searchValue, setSearchValue] = useState(currentSearch);

  function updateParams(updates: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }
    // Reset to page 1 when filters change (unless explicitly setting page)
    if (!("page" in updates)) {
      params.delete("page");
    }
    startTransition(() => {
      router.push(`/review-logs?${params.toString()}`);
    });
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    updateParams({ search: searchValue });
  }

  return (
    <div className={cn("mt-6 space-y-4", isPending && "opacity-60")}>
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form onSubmit={handleSearch} className="relative max-w-md flex-1">
          <IconSearch className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
          <Input
            placeholder="Search repository, title, or PR number"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            className="pl-9"
          />
        </form>

        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">Status:</span>
          <Select
            value={currentStatus}
            onValueChange={(value) => updateParams({ status: value })}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="reviewing">Reviewing</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-16">
                #
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground min-w-[250px]">
                NAME
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                REPOSITORY
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                AUTHOR
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                STATUS
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-16 text-center">
                ISSUES
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">
                LAST UPDATED
              </th>
            </tr>
          </thead>
          <tbody>
            {pullRequests.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-muted-foreground"
                >
                  No review logs found.
                </td>
              </tr>
            ) : (
              pullRequests.map((pr) => {
                const config = statusConfig[pr.status] || statusConfig.pending;
                const StatusIcon = config.icon;

                return (
                  <tr
                    key={pr.id}
                    className="border-b last:border-0 transition-colors hover:bg-muted/30"
                  >
                    <td className="px-4 py-3 text-muted-foreground">
                      {pr.number}
                    </td>
                    <td className="px-4 py-3 max-w-0">
                      <a
                        href={pr.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex items-center gap-1.5 font-medium hover:underline max-w-full"
                      >
                        <span className="truncate">{pr.title}</span>
                        <IconExternalLink className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground" />
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1.5 max-w-[180px]">
                            <ProviderIcon provider={pr.repoProvider} />
                            <span className="text-muted-foreground truncate">
                              {pr.repoFullName.split("/").pop()}
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          {pr.repoFullName}
                        </TooltipContent>
                      </Tooltip>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {pr.author}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <StatusIcon
                          className={cn("size-4", config.className)}
                        />
                        <span className={config.className}>
                          {config.label}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {pr.issueCount > 0 ? (
                        <Badge variant="secondary" className="text-xs">
                          {pr.issueCount}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap" suppressHydrationWarning>
                      {formatRelativeTime(pr.updatedAt)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-3">
        {pullRequests.length === 0 ? (
          <div className="rounded-lg border px-4 py-12 text-center text-muted-foreground">
            No review logs found.
          </div>
        ) : (
          pullRequests.map((pr) => {
            const config = statusConfig[pr.status] || statusConfig.pending;
            const StatusIcon = config.icon;

            return (
              <div
                key={pr.id}
                className="rounded-lg border p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium hover:underline text-sm leading-snug"
                  >
                    <span className="text-muted-foreground mr-1.5">#{pr.number}</span>
                    {pr.title}
                  </a>
                  <div className="flex items-center gap-1 shrink-0">
                    <StatusIcon className={cn("size-4", config.className)} />
                    <span className={cn("text-xs", config.className)}>
                      {config.label}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <ProviderIcon provider={pr.repoProvider} />
                    <span>{pr.repoFullName}</span>
                  </div>
                  <span>{pr.author}</span>
                  {pr.issueCount > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {pr.issueCount} issues
                    </Badge>
                  )}
                  <span suppressHydrationWarning>{formatRelativeTime(pr.updatedAt)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalCount > 0 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Items per page:
            </span>
            <span className="text-sm font-medium">10</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={currentPage <= 1}
              onClick={() =>
                updateParams({ page: String(currentPage - 1) })
              }
            >
              <IconChevronLeft className="size-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={currentPage >= totalPages}
              onClick={() =>
                updateParams({ page: String(currentPage + 1) })
              }
            >
              <IconChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
