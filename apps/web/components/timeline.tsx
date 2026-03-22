"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  IconUsers,
  IconGitPullRequest,
  IconBug,
  IconBrandGithub,
  IconSparkles,
  IconLoader2,
  IconChevronDown,
  IconChevronRight,
  IconFileCode,
  IconRefresh,
  IconFolder,
  IconExternalLink,
} from "@tabler/icons-react";
import {
  generateDailySummary,
  getDaySummary,
  loadWeek,
} from "@/app/(app)/timeline/actions";
import { CreateLinearIssueButton } from "@/components/create-linear-issue-dialog";
import { CreateGitHubIssueButton } from "@/components/create-github-issue-dialog";

// ── Types ─────────────────────────────────────────────────────

export type TimelineIssue = {
  id: string;
  title: string;
  severity: string;
  filePath: string | null;
  lineNumber: number | null;
  linearIssueId: string | null;
  linearIssueUrl: string | null;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  repoProvider: string;
};

export type TimelineItem = {
  repoName: string;
  repoProvider: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  author: string;
  status: string;
  time: string;
  issues: TimelineIssue[];
};

export type TimelineDay = {
  date: string;
  label: string;
  contributors: number;
  prsReviewed: number;
  findings: number;
  items: TimelineItem[];
};

export type TimelineWeek = {
  weekKey: string; // "2026-02-16" (Monday)
  label: string; // "This Week", "Last Week", "Week 8 · Feb 17-23, 2026"
  weekStart: string;
  weekEnd: string;
  totalPrs: number;
  totalReviewed: number;
  totalContributors: number;
  totalFindings: number;
  days: TimelineDay[];
};

// ── Main Component ────────────────────────────────────────────

export function Timeline({
  initialWeeks,
  currentWeekStart: _currentWeekStart,
  linearConnected = false,
  githubConnected = false,
}: {
  initialWeeks: TimelineWeek[];
  currentWeekStart: string;
  linearConnected?: boolean;
  githubConnected?: boolean;
}) {
  const [weeks, setWeeks] = useState<TimelineWeek[]>(initialWeeks);
  const [loading, setLoading] = useState(false);
  const [weekPickerValue, setWeekPickerValue] = useState("");

  async function handleLoadPrevious() {
    setLoading(true);
    try {
      const oldest = weeks[weeks.length - 1];
      const prevMonday = new Date(oldest.weekStart + "T00:00:00");
      prevMonday.setDate(prevMonday.getDate() - 7);
      const prevMondayISO = prevMonday.toISOString().split("T")[0];

      // Don't load if already loaded
      if (weeks.some((w) => w.weekKey === prevMondayISO)) return;

      const week = await loadWeek(prevMondayISO);
      setWeeks((prev) => [...prev, week]);
    } catch (err) {
      console.error("Failed to load week:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleWeekPick(value: string) {
    setWeekPickerValue(value);
    if (!value) return;

    setLoading(true);
    try {
      // Convert "2026-W08" to Monday date
      const [yearStr, weekStr] = value.split("-W");
      const year = parseInt(yearStr, 10);
      const weekNum = parseInt(weekStr, 10);
      const jan4 = new Date(year, 0, 4);
      const jan4Day = jan4.getDay() || 7;
      const jan4Monday = new Date(jan4);
      jan4Monday.setDate(jan4.getDate() - (jan4Day - 1));
      const monday = new Date(jan4Monday);
      monday.setDate(monday.getDate() + (weekNum - 1) * 7);
      const mondayISO = monday.toISOString().split("T")[0];

      // Already loaded?
      if (weeks.some((w) => w.weekKey === mondayISO)) return;

      const week = await loadWeek(mondayISO);
      setWeeks((prev) =>
        [...prev, week].sort((a, b) => b.weekKey.localeCompare(a.weekKey))
      );
    } catch (err) {
      console.error("Failed to load week:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {/* Week picker */}
      <div className="mb-6 flex items-center gap-3">
        <label
          htmlFor="week-picker"
          className="text-sm text-muted-foreground"
        >
          Jump to week:
        </label>
        <input
          id="week-picker"
          type="week"
          value={weekPickerValue}
          onChange={(e) => handleWeekPick(e.target.value)}
          className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {weeks.map((week) => (
        <WeekSection key={week.weekKey} week={week} linearConnected={linearConnected} githubConnected={githubConnected} />
      ))}

      {/* Load previous week */}
      <div className="mt-6 flex justify-center">
        <Button
          variant="outline"
          onClick={handleLoadPrevious}
          disabled={loading}
          className="gap-2"
        >
          {loading ? (
            <IconLoader2 className="size-4 animate-spin" />
          ) : null}
          Load Previous Week
        </Button>
      </div>
    </div>
  );
}

// ── Week Section ──────────────────────────────────────────────

function WeekSection({ week, linearConnected, githubConnected }: { week: TimelineWeek; linearConnected: boolean; githubConnected: boolean }) {
  if (week.days.length === 0) {
    return (
      <div className="mb-8">
        <WeekHeader week={week} />
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <IconGitPullRequest className="mb-3 size-8 opacity-40" />
          <p className="text-sm">No activity this week</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8">
      <WeekHeader week={week} />
      <div className="relative">
        {week.days.map((day) => (
          <DaySection key={day.date} day={day} linearConnected={linearConnected} githubConnected={githubConnected} />
        ))}
      </div>
    </div>
  );
}

function WeekHeader({ week }: { week: TimelineWeek }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b pb-3">
      <h2 className="text-lg font-semibold tracking-tight">{week.label}</h2>
      <div className="flex gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <IconGitPullRequest className="size-3" />
          {week.totalPrs} PRs
        </span>
        <span className="flex items-center gap-1">
          <IconUsers className="size-3" />
          {week.totalContributors}
        </span>
        <span className="flex items-center gap-1">
          <IconBug className="size-3" />
          {week.totalFindings} issues
        </span>
      </div>
    </div>
  );
}

// ── Day Section ───────────────────────────────────────────────

function groupByRepo(items: TimelineItem[]): { repoName: string; items: TimelineItem[] }[] {
  const map = new Map<string, TimelineItem[]>();
  for (const item of items) {
    const list = map.get(item.repoName) ?? [];
    list.push(item);
    map.set(item.repoName, list);
  }
  return Array.from(map.entries()).map(([repoName, items]) => ({ repoName, items }));
}

function RepoGroup({ repoName, items, linearConnected, githubConnected }: { repoName: string; items: TimelineItem[]; linearConnected: boolean; githubConnected: boolean }) {
  // Show short name (org/repo → repo)
  const shortName = repoName.includes("/") ? repoName.split("/").pop()! : repoName;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <IconFolder className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{shortName}</span>
        <span className="text-[10px] text-muted-foreground/60">{items.length} PR{items.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="ml-5 space-y-2 border-l border-border/50 pl-3">
        {items.map((item, i) => (
          <PRCard key={i} item={item} linearConnected={linearConnected} githubConnected={githubConnected} />
        ))}
      </div>
    </div>
  );
}

function DaySection({ day, linearConnected, githubConnected }: { day: TimelineDay; linearConnected: boolean; githubConnected: boolean }) {
  const repoGroups = groupByRepo(day.items);

  return (
    <div className="group relative">
      {/* Mobile */}
      <div className="sm:hidden">
        <div className="relative border-l-2 pb-8 pl-5 group-last:pb-3">
          <div className="absolute top-1 -left-px h-3 w-3 -translate-x-1/2 rounded-full border-2 border-primary bg-background" />
          <div className="flex items-baseline gap-2 flex-wrap">
            <h6 className="font-semibold text-primary text-sm">{day.label}</h6>
            <span className="text-muted-foreground text-xs">{day.date}</span>
          </div>
          <div className="mt-1.5 flex gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <IconUsers className="size-3" />
              {day.contributors}
            </span>
            <span className="flex items-center gap-1">
              <IconGitPullRequest className="size-3" />
              {day.prsReviewed}
            </span>
            <span className="flex items-center gap-1">
              <IconBug className="size-3" />
              {day.findings}
            </span>
          </div>
          <div className="mt-3">
            <DaySummary date={day.date} hasReviews={day.prsReviewed > 0} totalPrs={day.items.length} />
          </div>
          <div className="mt-3 space-y-4">
            {repoGroups.map((group) => (
              <RepoGroup key={group.repoName} repoName={group.repoName} items={group.items} linearConnected={linearConnected} githubConnected={githubConnected} />
            ))}
          </div>
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden sm:block">
        <div className="flex items-start">
          <div className="mt-3 mr-5 flex w-[130px] shrink-0 flex-col gap-2 text-end">
            <h6 className="font-semibold text-primary text-sm">{day.label}</h6>
            <span className="text-muted-foreground text-xs">{day.date}</span>
            <div className="mt-1 flex flex-col gap-1.5 items-end">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>{day.contributors}</span>
                <IconUsers className="size-3" />
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>{day.prsReviewed}</span>
                <IconGitPullRequest className="size-3" />
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>{day.findings}</span>
                <IconBug className="size-3" />
              </div>
            </div>
          </div>
          <div className="relative space-y-3 border-l-2 pb-10 pl-8 group-last:pb-4 flex-1 min-w-0">
            <div className="absolute top-4 -left-px h-3 w-3 -translate-x-1/2 rounded-full border-2 border-primary bg-background" />
            <h3 className="mt-2 font-semibold text-base tracking-[-0.01em]">
              {day.items.length} activit{day.items.length === 1 ? "y" : "ies"}
            </h3>
            <DaySummary date={day.date} hasReviews={day.prsReviewed > 0} totalPrs={day.items.length} />
            <div className="space-y-4">
              {repoGroups.map((group) => (
                <RepoGroup key={group.repoName} repoName={group.repoName} items={group.items} linearConnected={linearConnected} githubConnected={githubConnected} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── PR Card with Issues ───────────────────────────────────────

function PRCard({ item, linearConnected, githubConnected }: { item: TimelineItem; linearConnected: boolean; githubConnected: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const hasIssues = item.issues.length > 0;

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start gap-3">
        <IconBrandGithub className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2 flex-wrap">
            <a
              href={item.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium hover:underline break-words min-w-0"
            >
              #{item.prNumber} {item.prTitle}
            </a>
            <Badge
              variant={
                item.status === "completed"
                  ? "default"
                  : item.status === "reviewing"
                    ? "secondary"
                    : "outline"
              }
              className="text-[10px] shrink-0"
            >
              {item.status}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground truncate">
            {item.repoName} &middot; {item.author} &middot; {item.time}
          </p>

          {hasIssues && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-1.5 flex items-center gap-1 text-xs text-orange-500 hover:text-orange-400 transition-colors"
            >
              {expanded ? (
                <IconChevronDown className="size-3" />
              ) : (
                <IconChevronRight className="size-3" />
              )}
              {item.issues.length} issue{item.issues.length !== 1 ? "s" : ""} found
            </button>
          )}
        </div>
      </div>

      {hasIssues && expanded && (
        <div className="mt-2 ml-7 space-y-1.5">
          {item.issues.map((issue) => (
            <IssueRow key={issue.id} issue={issue} linearConnected={linearConnected} githubConnected={githubConnected} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Issue Row ─────────────────────────────────────────────────

const severityColors: Record<string, string> = {
  critical: "bg-red-900/15 text-red-300 border-red-900/30",
  high: "bg-red-500/10 text-red-500 border-red-500/20",
  medium: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  low: "bg-blue-500/10 text-blue-500 border-blue-500/20",
};

function IssueRow({ issue, linearConnected, githubConnected }: { issue: TimelineIssue; linearConnected: boolean; githubConnected: boolean }) {
  const colorClass = severityColors[issue.severity] ?? severityColors.medium;
  return (
    <div className="flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs">
      <Badge variant="outline" className={`text-[10px] shrink-0 ${colorClass}`}>
        {issue.severity}
      </Badge>
      <div className="min-w-0 flex-1">
        <span className="font-medium">{issue.title}</span>
        {issue.filePath && (
          <span className="ml-1.5 inline-flex items-center gap-0.5 text-muted-foreground">
            <IconFileCode className="size-3" />
            {issue.filePath}
            {issue.lineNumber != null && `:${issue.lineNumber}`}
          </span>
        )}
      </div>
      {githubConnected && issue.repoProvider === "github" && !issue.githubIssueNumber && (
        <CreateGitHubIssueButton issueId={issue.id} />
      )}
      {issue.githubIssueNumber && issue.githubIssueUrl && (
        <a
          href={issue.githubIssueUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-foreground/20 bg-foreground/5 px-1.5 py-0.5 text-[10px] font-medium text-foreground/70 hover:bg-foreground/10 transition-colors"
        >
          #{issue.githubIssueNumber}
          <IconExternalLink className="size-2.5" />
        </a>
      )}
      {linearConnected && !issue.linearIssueId && (
        <CreateLinearIssueButton issueId={issue.id} />
      )}
      {issue.linearIssueId && issue.linearIssueUrl && (
        <a
          href={issue.linearIssueUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-[#5E6AD2]/30 bg-[#5E6AD2]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#5E6AD2] hover:bg-[#5E6AD2]/20 transition-colors"
        >
          Linear
          <IconExternalLink className="size-2.5" />
        </a>
      )}
    </div>
  );
}

// ── Day Summary (AI) ──────────────────────────────────────────

function DaySummary({
  date,
  hasReviews,
  totalPrs,
}: {
  date: string;
  hasReviews: boolean;
  totalPrs: number;
}) {
  const [summary, setSummary] = useState<string | null>(null);
  const [savedPrCount, setSavedPrCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [, setLoadedFromDb] = useState(false);

  // Load existing summary from DB on mount
  useEffect(() => {
    if (!hasReviews) return;
    getDaySummary(date).then((existing) => {
      if (existing) {
        setSummary(existing.summary);
        setSavedPrCount(existing.prCount);
        setLoadedFromDb(true);
      }
    });
  }, [date, hasReviews]);

  if (!hasReviews) return null;

  const hasNewPrs = savedPrCount !== null && totalPrs > savedPrCount;

  async function handleGenerate() {
    setLoading(true);
    try {
      const result = await generateDailySummary(date);
      setSummary(result);
      setSavedPrCount(totalPrs);
      setLoadedFromDb(true);
    } catch (err) {
      setSummary("Failed to generate summary.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (summary) {
    return (
      <div className="rounded-md border border-purple-500/20 bg-purple-500/5 p-3">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <IconSparkles className="size-3.5 text-purple-400" />
            <span className="text-xs font-medium text-purple-400">
              AI Summary
            </span>
          </div>
          {hasNewPrs && (
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium text-purple-400 hover:bg-purple-500/10 transition-colors disabled:opacity-50"
            >
              {loading ? (
                <IconLoader2 className="size-3 animate-spin" />
              ) : (
                <IconRefresh className="size-3" />
              )}
              Re-summarize
            </button>
          )}
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {summary}
        </p>
      </div>
    );
  }

  return (
    <button
      onClick={handleGenerate}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-md border border-dashed border-purple-500/30 px-3 py-2 text-xs text-purple-400 hover:bg-purple-500/5 transition-colors disabled:opacity-50"
    >
      {loading ? (
        <IconLoader2 className="size-3.5 animate-spin" />
      ) : (
        <IconSparkles className="size-3.5" />
      )}
      {loading ? "Generating summary\u2026" : "Summarize this day"}
    </button>
  );
}
