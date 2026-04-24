"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IconBrandGithub,
  IconGitBranch,
  IconExternalLink,
  IconSearch,
  IconLoader2,
  IconCircleCheck,
  IconAlertTriangle,
  IconArrowLeft,
  IconFileCode,
  IconVectorTriangle,
  IconPuzzle,
  IconClock,
  IconCalendar,
  IconSparkles,
  IconRefresh,
  IconDatabaseImport,
  IconGitPullRequest,
  IconGitMerge,
  IconUsers,
  IconX,
  IconStar,
  IconStarFilled,
  IconRouteSquare2,
  IconTrash,
  IconArrowsTransferDown,
  IconChevronLeft,
  IconChevronRight,
  IconBrandBitbucket,
  IconFilter,
  IconSettings,
  IconPackage,
  IconMessageCircle,
} from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { extractAllMermaidBlocks, DIAGRAM_TYPE_LABELS, type DiagramType, type MermaidBlock } from "@/lib/mermaid-utils";
import { analyzeRepository, cancelAnalysis, toggleAutoReview, toggleFavoriteRepository, deletePullRequestReview, cancelPullRequestReview, updateRepoModels, transferRepository, getRepoDetail, updateReviewConfig, type RepoDetailData } from "./actions";
import { indexRepository, cancelIndexing, syncRepos } from "../actions";
import { Switch } from "@/components/ui/switch";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { IndexingLogs } from "@/components/indexing-logs";
import { AnalysisLogs } from "@/components/analysis-logs";
import { Label } from "@/components/ui/label";
import { getPubbyClient } from "@/lib/pubby-client";
import { useChat } from "@/components/chat-provider";

type AvailableModel = {
  modelId: string;
  displayName: string;
  provider: string;
  category: string;
};

type OtherOrg = {
  id: string;
  name: string;
  slug: string;
};

type PullRequestItem = {
  id: string;
  number: number;
  title: string;
  url: string;
  author: string;
  status: string;
  reviewBody: string | null;
  mergedAt: string | null;
  createdAt: string;
};

type Repo = {
  id: string;
  name: string;
  fullName: string;
  provider: string;
  defaultBranch: string;
  isActive: boolean;
  autoReview: boolean;
  indexStatus: string;
  indexedAt: string | null;
  indexedFiles: number;
  totalFiles: number;
  totalChunks: number;
  totalVectors: number;
  indexDurationMs: number | null;
  contributorCount: number;
  analysisStatus: string;
  analyzedAt: string | null;
  reviewModelId: string | null;
  embedModelId: string | null;
  reviewConfig: Record<string, unknown>;
  pullRequestCount: number;
};

const providerConfig: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; repoUrl: (fullName: string) => string }
> = {
  github: {
    icon: IconBrandGithub,
    repoUrl: (fullName) => `https://github.com/${fullName}`,
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

function StatusDot({ status }: { status: string }) {
  const color =
    status === "indexed"
      ? "bg-emerald-500"
      : status === "indexing"
        ? "bg-yellow-500 animate-pulse"
        : status === "failed"
          ? "bg-red-500"
          : "bg-gray-400";
  return <span className={`inline-block size-2 rounded-full ${color}`} />;
}

function IndexStatusBadge({ status }: { status: string }) {
  if (status === "indexed") {
    return (
      <Badge variant="default" className="bg-emerald-600">
        <IconCircleCheck className="mr-1 size-3" />
        Indexed
      </Badge>
    );
  }
  if (status === "indexing") {
    return (
      <Badge variant="secondary">
        <IconLoader2 className="mr-1 size-3 animate-spin" />
        Indexing...
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive">
        <IconAlertTriangle className="mr-1 size-3" />
        Failed
      </Badge>
    );
  }
  if (status === "stale") {
    return (
      <Badge variant="secondary" className="border-yellow-600/30 bg-yellow-600/10 text-yellow-600">
        <IconRefresh className="mr-1 size-3" />
        Stale
      </Badge>
    );
  }
  return (
    <Badge variant="outline">Pending</Badge>
  );
}

function StatsGrid({ repo }: { repo: Repo }) {
  if ((repo.indexStatus !== "indexed" && repo.indexStatus !== "stale") || !repo.indexedAt) return null;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      <div className="rounded-md border bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
          <IconFileCode className="size-3" />
          Files
        </div>
        <div className="mt-0.5 text-sm font-semibold">
          {repo.indexedFiles}
          <span className="font-normal text-muted-foreground">/{repo.totalFiles}</span>
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
          {repo.indexDurationMs ? formatDuration(repo.indexDurationMs) : "\u2014"}
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
  );
}

function parseMarkdownSections(markdown: string): { title: string; content: string }[] {
  const sections: { title: string; content: string }[] = [];
  const parts = markdown.split(/^## /m);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const newlineIdx = trimmed.indexOf("\n");
    if (newlineIdx === -1) {
      sections.push({ title: trimmed, content: "" });
    } else {
      sections.push({
        title: trimmed.slice(0, newlineIdx).trim(),
        content: trimmed.slice(newlineIdx + 1).trim(),
      });
    }
  }

  return sections;
}

function renderInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code class="rounded bg-muted px-1 py-0.5 text-xs font-mono">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function renderMarkdownContent(content: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      nodes.push(
        <pre
          key={`code-${nodes.length}`}
          className="my-2 overflow-x-auto rounded-md bg-muted p-3 text-xs font-mono"
        >
          {codeLines.join("\n")}
        </pre>,
      );
      continue;
    }

    // List items
    if (line.match(/^[-*] /)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        listItems.push(lines[i].replace(/^[-*] /, ""));
        i++;
      }
      nodes.push(
        <ul key={`list-${nodes.length}`} className="my-2 space-y-1 pl-4">
          {listItems.map((item, idx) => (
            <li
              key={idx}
              className="list-disc text-sm text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(item) }}
            />
          ))}
        </ul>,
      );
      continue;
    }

    // Numbered list items
    if (line.match(/^\d+\. /)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        listItems.push(lines[i].replace(/^\d+\. /, ""));
        i++;
      }
      nodes.push(
        <ol key={`olist-${nodes.length}`} className="my-2 space-y-1 pl-4">
          {listItems.map((item, idx) => (
            <li
              key={idx}
              className="list-decimal text-sm text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(item) }}
            />
          ))}
        </ol>,
      );
      continue;
    }

    // Empty lines
    if (!line.trim()) {
      i++;
      continue;
    }

    // Regular paragraphs
    nodes.push(
      <p
        key={`p-${nodes.length}`}
        className="my-2 text-sm text-muted-foreground leading-relaxed"
        dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(line) }}
      />,
    );
    i++;
  }

  return nodes;
}

function ReviewStatusBadge({ status, mergedAt }: { status: string; mergedAt?: string | null }) {
  if (mergedAt) {
    return (
      <Badge variant="default" className="bg-purple-600 text-[10px]">
        <IconGitMerge className="mr-1 size-3" />
        Merged
      </Badge>
    );
  }

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

function DiagramButton({ pr, onDeleted }: { pr: PullRequestItem; onDeleted?: (prId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDeleteTransition] = useTransition();
  const blocks = useMemo(() => extractAllMermaidBlocks(pr.reviewBody), [pr.reviewBody]);

  if (blocks.length === 0) return null;

  const handleDelete = () => {
    startDeleteTransition(async () => {
      await deletePullRequestReview(pr.id);
      setConfirmDelete(false);
      setOpen(false);
      onDeleted?.(pr.id);
    });
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className="relative shrink-0 text-muted-foreground hover:text-purple-500"
        onClick={() => setOpen(true)}
        title="View diagrams"
      >
        <IconRouteSquare2 className="size-3.5" />
        {blocks.length > 1 && (
          <span className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-purple-600 text-[9px] font-bold text-white">
            {blocks.length}
          </span>
        )}
      </Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setConfirmDelete(false); }}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-[90vw]" showCloseButton={false}>
          <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-6 py-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Badge variant="secondary" className="text-[10px]">
                {DIAGRAM_TYPE_LABELS[blocks[activeIdx].type]}
              </Badge>
              #{pr.number} {pr.title}
            </div>
            <div className="flex items-center gap-1">
              {confirmDelete ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-destructive">Permanently delete this review?</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={deleting}
                    onClick={handleDelete}
                  >
                    {deleting ? (
                      <IconLoader2 className="mr-1 size-3 animate-spin" />
                    ) : (
                      <IconTrash className="mr-1 size-3" />
                    )}
                    {deleting ? "Deleting..." : "Delete"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                  title="Delete this review"
                >
                  <IconTrash className="size-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setOpen(false)}
              >
                <IconX className="size-4" />
                <span className="sr-only">Close</span>
              </Button>
            </div>
          </div>
          <div className="overflow-auto p-6">
            {blocks.length > 1 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {blocks.map((block, idx) => (
                  <Button
                    key={idx}
                    variant={activeIdx === idx ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setActiveIdx(idx)}
                  >
                    {DIAGRAM_TYPE_LABELS[block.type]}
                  </Button>
                ))}
              </div>
            )}
            <MermaidDiagram code={blocks[activeIdx].code} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CancelReviewButton({ prId, onCancelled }: { prId: string; onCancelled?: () => void }) {
  const [cancelling, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="shrink-0 text-muted-foreground hover:text-destructive"
      title="Cancel review"
      disabled={cancelling}
      onClick={() => {
        startTransition(async () => {
          const result = await cancelPullRequestReview(prId);
          if (result.error) {
            toast.error(result.error);
          } else {
            onCancelled?.();
          }
        });
      }}
    >
      {cancelling ? (
        <IconLoader2 className="size-3.5 animate-spin" />
      ) : (
        <IconX className="size-3.5" />
      )}
    </Button>
  );
}

function PullRequestRow({ pr, onPrDeleted }: { pr: PullRequestItem; onPrDeleted?: (prId: string) => void }) {
  const isReviewing = pr.status === "reviewing" || pr.status === "pending";

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
      <a
        href={pr.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-sm font-medium hover:underline truncate min-w-0 flex-1"
      >
        <span className="text-muted-foreground">#{pr.number}</span>
        <span className="truncate">{pr.title}</span>
        <IconExternalLink className="size-3 shrink-0 text-muted-foreground" />
      </a>
      <DiagramButton pr={pr} onDeleted={onPrDeleted} />
      <span className="text-xs text-muted-foreground shrink-0">{pr.author}</span>
      {isReviewing && <CancelReviewButton prId={pr.id} />}
      <ReviewStatusBadge status={pr.status} mergedAt={pr.mergedAt} />
    </div>
  );
}

function PullRequestList({ pullRequests, onPrDeleted }: { pullRequests: PullRequestItem[]; onPrDeleted?: (prId: string) => void }) {
  if (pullRequests.length === 0) return null;

  const activePrs = pullRequests.filter((pr) => !pr.mergedAt);
  const mergedPrs = pullRequests.filter((pr) => !!pr.mergedAt);

  return (
    <div className="space-y-4">
      {activePrs.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <IconGitPullRequest className="size-3.5" />
            Active Pull Requests ({activePrs.length})
          </div>
          <div className="space-y-1.5">
            {activePrs.map((pr) => (
              <PullRequestRow key={pr.id} pr={pr} onPrDeleted={onPrDeleted} />
            ))}
          </div>
        </div>
      )}
      {mergedPrs.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <IconGitMerge className="size-3.5" />
            Merged Pull Requests ({mergedPrs.length})
          </div>
          <div className="space-y-1.5">
            {mergedPrs.map((pr) => (
              <PullRequestRow key={pr.id} pr={pr} onPrDeleted={onPrDeleted} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AnalysisSection({
  repo,
  analysisStatus,
  orgId,
  analysis,
}: {
  repo: Repo;
  analysisStatus: string;
  orgId: string;
  analysis: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [cancelPending, startCancelTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = () => {
    setError(null);
    startTransition(async () => {
      const result = await analyzeRepository(repo.id);
      if (result.error) setError(result.error);
    });
  };

  const handleCancel = () => {
    startCancelTransition(async () => {
      await cancelAnalysis(repo.id);
    });
  };

  const normalizedStatus = analysisStatus === "completed" ? "analyzed" : analysisStatus;
  const effectiveStatus = pending ? "analyzing" : normalizedStatus;

  if (effectiveStatus === "analyzing") {
    return (
      <div className="space-y-0">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-3">
              <IconLoader2 className="size-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Analyzing codebase...</p>
              <p className="text-xs text-muted-foreground/60">This may take a minute</p>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleCancel}
                disabled={cancelPending}
                className="mt-2"
              >
                {cancelPending ? (
                  <>
                    <IconLoader2 className="mr-1 size-3 animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  <>
                    <IconX className="mr-1 size-3" />
                    Cancel Analysis
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
        <AnalysisLogs repoId={repo.id} orgId={orgId} isAnalyzing />
      </div>
    );
  }

  if (effectiveStatus === "analyzed" && analysis) {
    const sections = parseMarkdownSections(analysis);
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconSparkles className="size-4 text-purple-500" />
            <span className="text-sm font-medium">AI Code Analysis</span>
            {repo.analyzedAt && (
              <span className="text-xs text-muted-foreground">
                {formatDate(repo.analyzedAt)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {repo.provider !== "bitbucket" && (
              <Link href={`/package-analyzer?repo=${encodeURIComponent(`https://github.com/${repo.fullName}`)}&repoId=${repo.id}`}>
                <Button size="sm" variant="outline" className="h-7 text-xs">
                  <IconPackage className="mr-1 size-3" />
                  Package Analyzer
                </Button>
              </Link>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={handleAnalyze}
            >
              <IconRefresh className="mr-1 size-3" />
              Re-analyze
            </Button>
          </div>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Accordion type="multiple" defaultValue={[sections[0]?.title ?? ""]} className="space-y-2">
          {sections.map((section, idx) => (
            <AccordionItem key={idx} value={section.title} className="rounded-md border bg-card px-4">
              <AccordionTrigger className="text-sm font-semibold">
                {section.title}
              </AccordionTrigger>
              <AccordionContent>
                {renderMarkdownContent(section.content)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    );
  }

  if (effectiveStatus === "failed") {
    return (
      <div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-8">
            <IconAlertTriangle className="size-6 text-destructive" />
            <p className="text-sm text-muted-foreground">Analysis failed</p>
            <Button size="sm" variant="cta" onClick={handleAnalyze}>
              <IconRefresh className="mr-1 size-3" />
              Retry
            </Button>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </CardContent>
        </Card>
        <AnalysisLogs repoId={repo.id} orgId={orgId} isAnalyzing={false} />
      </div>
    );
  }

  // none status
  const notIndexed = repo.indexStatus !== "indexed";
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-8">
        <IconSparkles className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {notIndexed
            ? "Index this repository first to run AI analysis"
            : "Run AI analysis to get architecture insights, code quality assessment, and more"}
        </p>
        <Button
          size="sm"
          variant="cta"
          onClick={handleAnalyze}
          disabled={notIndexed}
        >
          <IconSparkles className="mr-1 size-3" />
          Run Analysis
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function DiagramsPanel({ pullRequests, onPrDeleted }: { pullRequests: PullRequestItem[]; onPrDeleted?: (prId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [activeBlock, setActiveBlock] = useState<{ block: MermaidBlock; pr: PullRequestItem } | null>(null);
  const [typeFilter, setTypeFilter] = useState<DiagramType | "all">("all");
  const [confirmDeletePrId, setConfirmDeletePrId] = useState<string | null>(null);
  const [deleting, startDeleteTransition] = useTransition();

  const allDiagrams = useMemo(() => {
    const items: { block: MermaidBlock; pr: PullRequestItem }[] = [];
    for (const pr of pullRequests) {
      const blocks = extractAllMermaidBlocks(pr.reviewBody);
      for (const block of blocks) {
        items.push({ block, pr });
      }
    }
    return items;
  }, [pullRequests]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allDiagrams.length };
    for (const { block } of allDiagrams) {
      counts[block.type] = (counts[block.type] ?? 0) + 1;
    }
    return counts;
  }, [allDiagrams]);

  const filtered = useMemo(
    () => typeFilter === "all" ? allDiagrams : allDiagrams.filter((d) => d.block.type === typeFilter),
    [allDiagrams, typeFilter],
  );

  const handleDelete = (prId: string) => {
    startDeleteTransition(async () => {
      await deletePullRequestReview(prId);
      setConfirmDeletePrId(null);
      setOpen(false);
      setActiveBlock(null);
      onPrDeleted?.(prId);
    });
  };

  if (allDiagrams.length === 0) return null;

  const filterTypes: (DiagramType | "all")[] = ["all", "flowchart", "sequence", "er", "state"];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <IconRouteSquare2 className="size-3.5" />
        Diagrams ({allDiagrams.length})
      </div>
      <div className="flex flex-wrap gap-1.5">
        {filterTypes.map((t) => {
          const count = typeCounts[t] ?? 0;
          if (t !== "all" && count === 0) return null;
          return (
            <Button
              key={t}
              variant={typeFilter === t ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setTypeFilter(t)}
            >
              {t === "all" ? "All" : DIAGRAM_TYPE_LABELS[t]} ({count})
            </Button>
          );
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {filtered.map(({ block, pr }, idx) => (
          <button
            key={`${pr.id}-${idx}`}
            type="button"
            className="flex flex-col gap-1 rounded-md border bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted/60"
            onClick={() => { setActiveBlock({ block, pr }); setOpen(true); setConfirmDeletePrId(null); }}
          >
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {DIAGRAM_TYPE_LABELS[block.type]}
              </Badge>
              <span className="text-xs text-muted-foreground">#{pr.number}</span>
              <span className="truncate text-xs font-medium">{pr.title}</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>{pr.author}</span>
              <span>{formatDate(pr.createdAt)}</span>
            </div>
          </button>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-[90vw]" showCloseButton={false}>
          {activeBlock && (
            <>
              <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-6 py-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Badge variant="secondary" className="text-[10px]">
                    {DIAGRAM_TYPE_LABELS[activeBlock.block.type]}
                  </Badge>
                  #{activeBlock.pr.number} {activeBlock.pr.title}
                </div>
                <div className="flex items-center gap-1">
                  {confirmDeletePrId === activeBlock.pr.id ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-destructive">Permanently delete this review?</span>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={deleting}
                        onClick={() => handleDelete(activeBlock.pr.id)}
                      >
                        {deleting ? (
                          <IconLoader2 className="mr-1 size-3 animate-spin" />
                        ) : (
                          <IconTrash className="mr-1 size-3" />
                        )}
                        {deleting ? "Deleting..." : "Delete"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setConfirmDeletePrId(null)}
                        disabled={deleting}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setConfirmDeletePrId(activeBlock.pr.id)}
                      title="Delete this review"
                    >
                      <IconTrash className="size-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setOpen(false)}
                  >
                    <IconX className="size-4" />
                    <span className="sr-only">Close</span>
                  </Button>
                </div>
              </div>
              <div className="overflow-auto p-6">
                <MermaidDiagram code={activeBlock.block.code} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-4 w-48 rounded bg-muted" />
      <div className="h-20 rounded bg-muted" />
      <div className="h-4 w-32 rounded bg-muted" />
      <div className="space-y-2">
        <div className="h-10 rounded bg-muted" />
        <div className="h-10 rounded bg-muted" />
        <div className="h-10 rounded bg-muted" />
      </div>
    </div>
  );
}

function RepoDetail({
  repo,
  analysisStatus,
  orgId,
  detail,
  detailLoading,
  availableModels,
  otherOrgs = [],
  onDetailRefresh,
}: {
  repo: Repo;
  analysisStatus: string;
  orgId: string;
  detail: RepoDetailData | null;
  detailLoading: boolean;
  availableModels: AvailableModel[];
  otherOrgs?: OtherOrg[];
  onDetailRefresh: () => void;
}) {
  const { openWithRepoContext } = useChat();
  const provider = providerConfig[repo.provider];
  const repoUrl = provider?.repoUrl(repo.fullName);
  const [indexPending, startIndexTransition] = useTransition();
  const [cancelPending, startCancelTransition] = useTransition();
  const [autoReviewPending, startAutoReviewTransition] = useTransition();
  const [modelSavePending, startModelSaveTransition] = useTransition();
  const [autoReview, setAutoReview] = useState(repo.autoReview);
  const [repoReviewModelId, setRepoReviewModelId] = useState(repo.reviewModelId ?? "");
  const [repoEmbedModelId, setRepoEmbedModelId] = useState(repo.embedModelId ?? "");
  const [modelSaved, setModelSaved] = useState(false);
  const [localPrs, setLocalPrs] = useState<PullRequestItem[]>(detail?.pullRequests ?? []);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTargetOrgId, setTransferTargetOrgId] = useState("");
  const [transferPending, startTransferTransition] = useTransition();
  const [transferError, setTransferError] = useState("");
  const [reviewConfigOpen, setReviewConfigOpen] = useState(false);
  const [reviewConfigPending, startReviewConfigTransition] = useTransition();
  const [reviewConfigSaved, setReviewConfigSaved] = useState(false);
  const [reviewConfigError, setReviewConfigError] = useState("");
  const [rcMaxFindings, setRcMaxFindings] = useState<number>((repo.reviewConfig?.maxFindings as number) ?? 30);
  const [rcInlineThreshold, setRcInlineThreshold] = useState<string>((repo.reviewConfig?.inlineThreshold as string) ?? "medium");
  const [rcConfidenceThreshold, setRcConfidenceThreshold] = useState<string>((repo.reviewConfig?.confidenceThreshold as string) ?? "MEDIUM");
  const [rcEnableConflict, setRcEnableConflict] = useState<string>(
    repo.reviewConfig?.enableConflictDetection === undefined ? "auto" : repo.reviewConfig?.enableConflictDetection ? "always" : "never"
  );
  const [rcTwoPass, setRcTwoPass] = useState<boolean>((repo.reviewConfig?.enableTwoPassReview as boolean) ?? false);
  const [rcDisabledCategories, setRcDisabledCategories] = useState<string>(
    ((repo.reviewConfig?.disabledCategories as string[]) ?? []).join(", ")
  );
  const router = useRouter();
  const isIndexing = repo.indexStatus === "indexing" || indexPending;
  const canAutoReview = (repo.indexStatus === "indexed" || repo.indexStatus === "stale") && (analysisStatus === "analyzed" || analysisStatus === "completed");

  // Sync localPrs when detail data changes
  useEffect(() => {
    if (detail?.pullRequests) {
      setLocalPrs(detail.pullRequests);
    }
  }, [detail?.pullRequests]);

  const handlePrDeleted = (prId: string) => {
    setLocalPrs((prev) => prev.filter((pr) => pr.id !== prId));
    onDetailRefresh();
  };

  const handleIndex = () => {
    startIndexTransition(async () => {
      await indexRepository(repo.id);
    });
  };

  const handleCancel = () => {
    startCancelTransition(async () => {
      await cancelIndexing(repo.id);
    });
  };

  const handleAutoReviewToggle = (checked: boolean) => {
    setAutoReview(checked);
    startAutoReviewTransition(async () => {
      await toggleAutoReview(repo.id, checked);
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">{repo.fullName}</h2>
              {repoUrl && (
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <IconExternalLink className="size-4" />
                </a>
              )}
              <button
                type="button"
                onClick={() => setReviewConfigOpen(true)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Review configuration"
              >
                <IconSettings className="size-4" />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline">{repo.defaultBranch}</Badge>
              <IndexStatusBadge status={repo.indexStatus} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => openWithRepoContext(repo.fullName)}
              title="Chat about this repository"
            >
              <IconMessageCircle className="mr-1 size-3" />
              Chat
            </Button>
            {isIndexing ? (
              <Button
                size="sm"
                variant="destructive"
                onClick={handleCancel}
                disabled={cancelPending}
              >
                {cancelPending ? (
                  <>
                    <IconLoader2 className="mr-1 size-3 animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  <>
                    <IconX className="mr-1 size-3" />
                    Cancel
                  </>
                )}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="cta"
                onClick={handleIndex}
              >
                {repo.indexStatus === "indexed" ? (
                  <>
                    <IconRefresh className="mr-1 size-3" />
                    Re-index
                  </>
                ) : (
                  <>
                    <IconDatabaseImport className="mr-1 size-3" />
                    Create Index
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Auto Review */}
      <div className={`flex items-center justify-between rounded-md border bg-muted/30 px-4 py-3 ${!canAutoReview ? "opacity-60" : ""}`}>
        <div>
          <div className="text-sm font-medium">Auto Review</div>
          <div className="text-xs text-muted-foreground">
            {canAutoReview
              ? repo.indexStatus === "stale"
                ? "Index is stale. It will be automatically re-indexed on the next PR review."
                : "Automatically review new pull requests with AI"
              : "Index and analyze this repository first to enable auto review"}
          </div>
        </div>
        <Switch
          checked={canAutoReview && autoReview}
          onCheckedChange={handleAutoReviewToggle}
          disabled={autoReviewPending || !canAutoReview}
        />
      </div>

      {/* AI Models */}
      {availableModels.length > 0 && (
        <div className="rounded-md border bg-muted/30 px-4 py-3 space-y-3">
          <div className="text-sm font-medium">AI Models</div>
          <div className="text-xs text-muted-foreground">
            Override organization defaults for this repository.
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Review & Chat Model</Label>
              <select
                value={repoReviewModelId}
                onChange={(e) => setRepoReviewModelId(e.target.value)}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs shadow-sm transition-colors"
              >
                <option value="">(Org Default)</option>
                {availableModels
                  .filter((m) => m.category === "llm")
                  .map((m) => (
                    <option key={m.modelId} value={m.modelId}>
                      {m.displayName} ({m.provider})
                    </option>
                  ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Embedding Model</Label>
              <select
                value={repoEmbedModelId}
                onChange={(e) => setRepoEmbedModelId(e.target.value)}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs shadow-sm transition-colors"
              >
                <option value="">(Org Default)</option>
                {availableModels
                  .filter((m) => m.category === "embedding")
                  .map((m) => (
                    <option key={m.modelId} value={m.modelId}>
                      {m.displayName} ({m.provider})
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7"
              disabled={modelSavePending}
              onClick={() => {
                startModelSaveTransition(async () => {
                  await updateRepoModels(
                    repo.id,
                    repoReviewModelId || null,
                    repoEmbedModelId || null,
                  );
                  setModelSaved(true);
                  setTimeout(() => setModelSaved(false), 2000);
                });
              }}
            >
              {modelSavePending ? "Saving..." : "Save Models"}
            </Button>
            {modelSaved && (
              <span className="text-xs text-green-600">Saved</span>
            )}
          </div>
        </div>
      )}

      {/* Purpose */}
      {detailLoading ? (
        <div className="h-16 animate-pulse rounded-md bg-muted" />
      ) : detail?.purpose ? (
        <div className="rounded-md border bg-muted/30 px-4 py-3">
          <div className="text-[10px] font-medium text-muted-foreground">Purpose</div>
          <div className="mt-0.5 text-sm font-medium">{detail.purpose}</div>
        </div>
      ) : null}

      {/* Summary */}
      {detailLoading ? (
        <div className="h-16 animate-pulse rounded-md bg-muted" />
      ) : detail?.summary ? (
        <div className="rounded-md border bg-muted/30 px-4 py-3">
          <div className="text-[10px] font-medium text-muted-foreground">Summary</div>
          <div className="mt-0.5 text-sm text-muted-foreground">{detail.summary}</div>
        </div>
      ) : null}

      {/* Indexing Logs */}
      {(isIndexing || repo.indexStatus === "indexing" || repo.indexStatus === "failed") && (
        <IndexingLogs
          repoId={repo.id}
          orgId={orgId}
          initialStatus={isIndexing ? "indexing" : repo.indexStatus}
        />
      )}

      {/* Index Stats */}
      <StatsGrid repo={repo} />

      {/* Contributors */}
      {detailLoading ? (
        <div className="h-12 animate-pulse rounded-md bg-muted" />
      ) : detail && detail.contributors.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <IconUsers className="size-3.5" />
            Contributors ({repo.contributorCount})
          </div>
          <div className="flex flex-wrap gap-2">
            {detail.contributors.map((c) => (
              <a
                key={c.login}
                href={`https://github.com/${c.login}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-full border bg-muted/30 py-1 pl-1 pr-2.5 text-xs transition-colors hover:bg-muted"
                title={`${c.login} — ${c.contributions} contributions`}
              >
                <img
                  src={c.avatarUrl}
                  alt={c.login}
                  className="size-5 rounded-full"
                  loading="lazy"
                />
                <span>{c.login}</span>
              </a>
            ))}
          </div>
        </div>
      ) : null}

      {/* Pull Requests */}
      {detailLoading ? (
        <DetailSkeleton />
      ) : (
        <PullRequestList pullRequests={localPrs} onPrDeleted={handlePrDeleted} />
      )}

      {/* Diagrams */}
      {!detailLoading && (
        <DiagramsPanel pullRequests={localPrs} onPrDeleted={handlePrDeleted} />
      )}

      {/* Analysis */}
      {detailLoading ? (
        <div className="h-32 animate-pulse rounded-md bg-muted" />
      ) : (
        <AnalysisSection
          repo={repo}
          analysisStatus={analysisStatus}
          orgId={orgId}
          analysis={detail?.analysis ?? null}
        />
      )}

      {/* Review Configuration Modal */}
      <Dialog open={reviewConfigOpen} onOpenChange={(v) => {
        setReviewConfigOpen(v);
        if (!v) {
          setReviewConfigError("");
          setReviewConfigSaved(false);
        }
      }}>
        <DialogContent showCloseButton={false} className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Configuration</DialogTitle>
            <DialogDescription>
              Customize how Octopus reviews PRs for <span className="font-semibold">{repo.fullName}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label className="text-sm">Max findings per review</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={rcMaxFindings}
                onChange={(e) => setRcMaxFindings(Number(e.target.value))}
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                Limit the number of findings (1-50). Prioritized by severity.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Inline comment threshold</Label>
              <select
                value={rcInlineThreshold}
                onChange={(e) => setRcInlineThreshold(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              >
                <option value="medium">Medium & above (default)</option>
                <option value="high">High & above</option>
                <option value="critical">Critical only</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Findings below this threshold appear in a summary table instead of inline comments.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Confidence threshold</Label>
              <select
                value={rcConfidenceThreshold}
                onChange={(e) => setRcConfidenceThreshold(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              >
                <option value="MEDIUM">Medium & above (default)</option>
                <option value="HIGH">High only</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Conflict detection</Label>
              <select
                value={rcEnableConflict}
                onChange={(e) => setRcEnableConflict(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              >
                <option value="auto">Auto (when shared files touched)</option>
                <option value="always">Always</option>
                <option value="never">Never</option>
              </select>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm">Two-pass review</Label>
                <p className="text-xs text-muted-foreground">
                  Validates findings with a second LLM call. More accurate but costs more.
                </p>
              </div>
              <Switch
                checked={rcTwoPass}
                onCheckedChange={setRcTwoPass}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Disabled categories</Label>
              <Input
                value={rcDisabledCategories}
                onChange={(e) => setRcDisabledCategories(e.target.value)}
                placeholder="e.g. Style, Performance"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated. Findings in these categories will be suppressed.
              </p>
            </div>

            {reviewConfigError && <p className="text-sm text-destructive">{reviewConfigError}</p>}
            {reviewConfigSaved && <p className="text-sm text-green-600">Configuration saved.</p>}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setReviewConfigOpen(false)}
              disabled={reviewConfigPending}
            >
              Cancel
            </Button>
            <Button
              disabled={reviewConfigPending}
              onClick={() => {
                setReviewConfigError("");
                setReviewConfigSaved(false);
                startReviewConfigTransition(async () => {
                  const config: Record<string, unknown> = {
                    maxFindings: rcMaxFindings,
                    inlineThreshold: rcInlineThreshold,
                    confidenceThreshold: rcConfidenceThreshold,
                    enableTwoPassReview: rcTwoPass,
                  };
                  if (rcEnableConflict !== "auto") {
                    config.enableConflictDetection = rcEnableConflict === "always";
                  }
                  const cats = rcDisabledCategories.split(",").map((c) => c.trim()).filter(Boolean);
                  if (cats.length > 0) config.disabledCategories = cats;

                  const result = await updateReviewConfig(repo.id, config);
                  if (result.error) {
                    setReviewConfigError(result.error);
                  } else {
                    setReviewConfigSaved(true);
                    setTimeout(() => setReviewConfigSaved(false), 3000);
                  }
                });
              }}
            >
              {reviewConfigPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer Repository */}
      {otherOrgs.length > 0 && (
        <>
          <div className="rounded-md border border-orange-500/30 bg-orange-500/5 px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium">Transfer Repository</div>
                <div className="text-xs text-muted-foreground">
                  Move this repository to another organization you belong to.
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-fit shrink-0"
                onClick={() => setTransferOpen(true)}
              >
                <IconArrowsTransferDown className="mr-1 size-3" />
                Transfer
              </Button>
            </div>
          </div>

          <Dialog open={transferOpen} onOpenChange={(v) => {
            setTransferOpen(v);
            if (!v) {
              setTransferTargetOrgId("");
              setTransferError("");
            }
          }}>
            <DialogContent showCloseButton={false} className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Transfer Repository</DialogTitle>
                <DialogDescription>
                  Transfer <span className="font-semibold">{repo.fullName}</span> to another organization.
                  All pull requests, reviews, and data will move with it.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Target Organization</label>
                  <select
                    value={transferTargetOrgId}
                    onChange={(e) => setTransferTargetOrgId(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors"
                  >
                    <option value="">Select organization...</option>
                    {otherOrgs.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2 rounded-md bg-orange-500/10 border border-orange-500/20 px-3 py-2.5">
                  <IconAlertTriangle className="size-4 text-orange-500 shrink-0" />
                  <p className="text-sm text-orange-600 dark:text-orange-400">
                    This will remove the repository from the current organization.
                    Are you sure?
                  </p>
                </div>

                {transferError && (
                  <p className="text-sm text-destructive">{transferError}</p>
                )}
              </div>

              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => setTransferOpen(false)}
                  disabled={transferPending}
                >
                  Cancel
                </Button>
                <Button
                  disabled={!transferTargetOrgId || transferPending}
                  onClick={() => {
                    setTransferError("");
                    startTransferTransition(async () => {
                      const result = await transferRepository(repo.id, transferTargetOrgId);
                      if (result.error) {
                        setTransferError(result.error);
                        return;
                      }
                      setTransferOpen(false);
                      router.push("/repositories");
                      router.refresh();
                    });
                  }}
                >
                  {transferPending ? "Transferring..." : "Transfer Repository"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

function RepoListItem({
  repo,
  isSelected,
  isFavorite,
  status,
  pullRequestCount,
  onToggleFavorite,
}: {
  repo: Repo;
  isSelected: boolean;
  isFavorite: boolean;
  status: string;
  pullRequestCount: number;
  onToggleFavorite: (repoId: string) => void;
}) {
  const provider = providerConfig[repo.provider];
  const ProviderIcon = provider?.icon ?? IconGitBranch;
  const searchParams = useSearchParams();

  const params = new URLSearchParams(searchParams.toString());
  params.set("repo", repo.id);
  params.delete("page");
  const repoHref = `/repositories?${params.toString()}`;

  return (
    <Link
      href={repoHref}
      className={`flex items-center gap-3 border-b px-4 py-3 transition-colors hover:bg-accent/50 ${
        isSelected ? "bg-muted text-foreground" : ""
      }`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite(repo.id);
        }}
        className="shrink-0 text-muted-foreground hover:text-yellow-500 transition-colors"
      >
        {isFavorite ? (
          <IconStarFilled className="size-4 text-yellow-500" />
        ) : (
          <IconStar className="size-4" />
        )}
      </button>
      <ProviderIcon className={`size-4 shrink-0 ${isSelected ? "text-foreground/70" : "text-muted-foreground"}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{repo.name}</span>
          {repo.contributorCount > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
              <IconUsers className="mr-0.5 size-3" />
              {repo.contributorCount}
            </Badge>
          )}
          {pullRequestCount > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
              <IconGitPullRequest className="mr-0.5 size-3" />
              {pullRequestCount}
            </Badge>
          )}
        </div>
        <div className={`truncate text-xs ${isSelected ? "text-foreground/70" : "text-muted-foreground"}`}>
          {repo.fullName}
        </div>
      </div>
      <StatusDot status={status} />
    </Link>
  );
}

function SyncButton() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 text-xs"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await syncRepos();
          router.refresh();
        })
      }
    >
      <IconRefresh className={`mr-1 size-3 ${isPending ? "animate-spin" : ""}`} />
      {isPending ? "Syncing..." : "Sync"}
    </Button>
  );
}

function PaginationControls({
  currentPage,
  totalPages,
  totalCount,
}: {
  currentPage: number;
  totalPages: number;
  totalCount: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  if (totalPages <= 1) return null;

  const goToPage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (page > 1) params.set("page", String(page));
    else params.delete("page");
    router.push(`/repositories?${params.toString()}`);
  };

  return (
    <div className="flex items-center justify-between border-t px-4 py-2">
      <span className="text-xs text-muted-foreground">{totalCount} repos</span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={currentPage <= 1}
          onClick={() => goToPage(currentPage - 1)}
        >
          <IconChevronLeft className="size-4" />
        </Button>
        <span className="text-xs text-muted-foreground px-2">
          {currentPage} / {totalPages}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={currentPage >= totalPages}
          onClick={() => goToPage(currentPage + 1)}
        >
          <IconChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function RepositoriesContent({
  repos,
  orgId,
  selectedRepoId,
  githubAppSlug,
  favoriteRepoIds,
  availableModels = [],
  otherOrgs = [],
  owners = [],
  currentSearch = "",
  currentOwner = "",
  currentFilter = "",
  currentPage = 1,
  totalPages = 1,
  totalCount = 0,
  bitbucketWorkspaceSlug = null,
}: {
  repos: Repo[];
  orgId: string;
  selectedRepoId: string | null;
  githubAppSlug: string | null;
  favoriteRepoIds: string[];
  availableModels?: AvailableModel[];
  otherOrgs?: OtherOrg[];
  owners?: string[];
  currentSearch?: string;
  currentOwner?: string;
  currentFilter?: string;
  currentPage?: number;
  totalPages?: number;
  totalCount?: number;
  bitbucketWorkspaceSlug?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(currentSearch);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(
    () => new Set(favoriteRepoIds),
  );
  const [statuses, setStatuses] = useState<Record<string, string>>(() =>
    Object.fromEntries(repos.map((r) => [r.id, r.indexStatus])),
  );
  const [analysisStatuses, setAnalysisStatuses] = useState<Record<string, string>>(() =>
    Object.fromEntries(repos.map((r) => [r.id, r.analysisStatus])),
  );
  const [prCounts, setPrCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(repos.map((r) => [r.id, r.pullRequestCount])),
  );

  // Detail lazy loading
  const [repoDetail, setRepoDetail] = useState<RepoDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRefreshKey, setDetailRefreshKey] = useState(0);

  // Sync states when server data changes (e.g. after router.refresh)
  useEffect(() => {
    setStatuses(Object.fromEntries(repos.map((r) => [r.id, r.indexStatus])));
    setAnalysisStatuses(Object.fromEntries(repos.map((r) => [r.id, r.analysisStatus])));
    setPrCounts(Object.fromEntries(repos.map((r) => [r.id, r.pullRequestCount])));
  }, [repos]);

  // Sync search input when server search changes (e.g. browser back/forward)
  useEffect(() => {
    setSearchInput(currentSearch);
  }, [currentSearch]);

  // Fetch detail when selected repo changes
  useEffect(() => {
    if (!selectedRepoId) {
      setRepoDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    getRepoDetail(selectedRepoId).then((data) => {
      if (!cancelled) {
        setRepoDetail(data);
        setDetailLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [selectedRepoId, detailRefreshKey]);

  // Debounced search → URL params
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== currentSearch) {
        const params = new URLSearchParams(searchParams.toString());
        if (searchInput) params.set("search", searchInput);
        else params.delete("search");
        params.delete("page"); // reset to page 1
        params.delete("repo"); // clear selected repo
        router.push(`/repositories?${params.toString()}`);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, currentSearch, searchParams, router]);

  const handleOwnerChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value !== "all") params.set("owner", value);
    else params.delete("owner");
    params.delete("page");
    params.delete("repo");
    router.push(`/repositories?${params.toString()}`);
  };

  const handleFilterChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("filter");
    } else {
      params.set("filter", value);
    }
    params.delete("page");
    router.push(`/repositories?${params.toString()}`);
  };

  const handleToggleFavorite = (repoId: string) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (next.has(repoId)) {
        next.delete(repoId);
      } else {
        next.add(repoId);
      }
      return next;
    });
    toggleFavoriteRepository(repoId);
  };

  // Group repos: favorites at top, then indexed, then not indexed
  const { favoriteRepos, indexedRepos, notIndexedRepos } = useMemo(() => {
    const sortAlpha = (a: Repo, b: Repo) => a.name.localeCompare(b.name);
    const getStatus = (r: Repo) => statuses[r.id] ?? r.indexStatus;
    const favs = repos.filter((r) => favoriteIds.has(r.id)).sort(sortAlpha);
    const rest = repos.filter((r) => !favoriteIds.has(r.id));
    const indexed = rest.filter((r) => getStatus(r) === "indexed").sort(sortAlpha);
    const notIndexed = rest.filter((r) => getStatus(r) !== "indexed").sort(sortAlpha);
    return { favoriteRepos: favs, indexedRepos: indexed, notIndexedRepos: notIndexed };
  }, [repos, favoriteIds, statuses]);

  const selectedRepo = selectedRepoId
    ? repos.find((r) => r.id === selectedRepoId) ?? null
    : null;

  // Real-time updates
  useEffect(() => {
    const pubby = getPubbyClient();
    const channel = pubby.subscribe(`presence-org-${orgId}`);

    const handleIndexStatus = (raw: unknown) => {
      const data = raw as { repoId: string; status: string };
      const resolvedStatus = data.status === "cancelled" ? "pending" : data.status;
      setStatuses((prev) => ({ ...prev, [data.repoId]: resolvedStatus }));
      if (data.status === "indexed" || data.status === "cancelled") {
        router.refresh();
        setDetailRefreshKey((k) => k + 1);
      }
    };

    const handleAnalysisStatus = (raw: unknown) => {
      const data = raw as { repoId: string; status: string };
      setAnalysisStatuses((prev) => ({ ...prev, [data.repoId]: data.status }));
      if (data.status === "analyzed") {
        router.refresh();
        setDetailRefreshKey((k) => k + 1);
      }
    };

    const handleReviewRequested = (raw: unknown) => {
      const data = raw as { repoId: string; pullRequest: PullRequestItem };
      setPrCounts((prev) => ({ ...prev, [data.repoId]: (prev[data.repoId] ?? 0) + 1 }));
      // If this repo's detail is open, refresh it
      if (selectedRepoId === data.repoId) {
        setDetailRefreshKey((k) => k + 1);
      }
    };

    const handleReviewStatus = (raw: unknown) => {
      const data = raw as {
        repoId: string;
        pullRequestId: string;
        number: number;
        status: string;
        step: string;
      };
      if (data.status === "completed") {
        router.refresh();
        setDetailRefreshKey((k) => k + 1);
      }
    };

    channel.bind("index-status", handleIndexStatus);
    channel.bind("analysis-status", handleAnalysisStatus);
    channel.bind("review-requested", handleReviewRequested);
    channel.bind("review-status", handleReviewStatus);

    return () => {
      channel.unbind("index-status", handleIndexStatus);
      channel.unbind("analysis-status", handleAnalysisStatus);
      channel.unbind("review-requested", handleReviewRequested);
      channel.unbind("review-status", handleReviewStatus);
    };
  }, [orgId, router, selectedRepoId]);

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden lg:flex-row">
      {/* Left Panel - Repo List */}
      <div
        className={`${
          selectedRepo ? "hidden lg:flex" : "flex"
        } min-h-0 w-full flex-col border-r lg:w-80`}
      >
        <div className="border-b p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">Repositories</h1>
            <SyncButton />
          </div>
          <div className="relative mt-3">
            <IconSearch className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Search repositories..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Select value={currentOwner || "all"} onValueChange={handleOwnerChange}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All organizations</SelectItem>
                {owners.map((owner) => (
                  <SelectItem key={owner} value={owner}>
                    {owner}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={currentFilter || "all"} onValueChange={handleFilterChange}>
              <SelectTrigger className="h-8 text-xs">
                <IconFilter className="mr-1 size-3" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="indexed">Indexed</SelectItem>
                <SelectItem value="stale">Stale</SelectItem>
                <SelectItem value="not-indexed">Not indexed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="mt-2 flex items-center gap-2">
            {githubAppSlug && (
              <Button size="sm" variant="outline" className="h-8 shrink-0 text-xs" asChild>
                <a href="/api/github/install?returnTo=/repositories">
                  <IconBrandGithub className="mr-1 size-3" />
                  Manage GitHub
                </a>
              </Button>
            )}
            {bitbucketWorkspaceSlug && (
              <Button size="sm" variant="outline" className="h-8 shrink-0 text-xs" asChild>
                <a
                  href={`https://bitbucket.org/${bitbucketWorkspaceSlug}/workspace/settings/api`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <IconBrandBitbucket className="mr-1 size-3" />
                  Manage Bitbucket
                </a>
              </Button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-auto-hide">
          {favoriteRepos.length === 0 && indexedRepos.length === 0 && notIndexedRepos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <IconGitBranch className="mb-3 size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {currentSearch ? "No repositories match your search" : "No repositories yet"}
              </p>
            </div>
          ) : (
            <>
              {/* Favorites — always open, no accordion */}
              {favoriteRepos.length > 0 && (
                <>
                  {favoriteRepos.map((repo) => (
                    <RepoListItem
                      key={repo.id}
                      repo={repo}
                      isSelected={selectedRepoId === repo.id}
                      isFavorite={true}
                      status={statuses[repo.id] ?? repo.indexStatus}
                      pullRequestCount={prCounts[repo.id] ?? repo.pullRequestCount}
                      onToggleFavorite={handleToggleFavorite}
                    />
                  ))}
                </>
              )}

              {/* Indexed repos */}
              {indexedRepos.length > 0 && (
                <div>
                  <div className="px-4 py-2">
                    <span className="text-[10px] font-medium tracking-wider text-muted-foreground">
                      INDEXED ({indexedRepos.length})
                    </span>
                  </div>
                  {indexedRepos.map((repo) => (
                    <RepoListItem
                      key={repo.id}
                      repo={repo}
                      isSelected={selectedRepoId === repo.id}
                      isFavorite={false}
                      status={statuses[repo.id] ?? repo.indexStatus}
                      pullRequestCount={prCounts[repo.id] ?? repo.pullRequestCount}
                      onToggleFavorite={handleToggleFavorite}
                    />
                  ))}
                </div>
              )}

              {/* Not indexed repos */}
              {notIndexedRepos.length > 0 && (
                <div>
                  <div className="px-4 py-2">
                    <span className="text-[10px] font-medium tracking-wider text-muted-foreground">
                      NOT INDEXED ({notIndexedRepos.length})
                    </span>
                  </div>
                  {notIndexedRepos.map((repo) => (
                    <RepoListItem
                      key={repo.id}
                      repo={repo}
                      isSelected={selectedRepoId === repo.id}
                      isFavorite={false}
                      status={statuses[repo.id] ?? repo.indexStatus}
                      pullRequestCount={prCounts[repo.id] ?? repo.pullRequestCount}
                      onToggleFavorite={handleToggleFavorite}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Pagination */}
        <PaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          totalCount={totalCount}
        />
      </div>

      {/* Right Panel - Detail */}
      <div
        className={`${
          selectedRepo ? "flex" : "hidden lg:flex"
        } min-h-0 flex-1 flex-col overflow-y-auto bg-background`}
      >
        {selectedRepo ? (
          <div className="p-4 sm:p-6 lg:p-8">
            {/* Mobile back button */}
            <div className="mb-4 lg:hidden">
              <Link
                href="/repositories"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <IconArrowLeft className="size-4" />
                All repositories
              </Link>
            </div>
            <RepoDetail
              key={selectedRepo.id}
              repo={{
                ...selectedRepo,
                indexStatus: statuses[selectedRepo.id] ?? selectedRepo.indexStatus,
              }}
              analysisStatus={
                analysisStatuses[selectedRepo.id] ?? selectedRepo.analysisStatus
              }
              orgId={orgId}
              detail={repoDetail}
              detailLoading={detailLoading}
              availableModels={availableModels}
              otherOrgs={otherOrgs}
              onDetailRefresh={() => setDetailRefreshKey((k) => k + 1)}
            />
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <IconGitBranch className="mb-3 size-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Select a repository to view details
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
