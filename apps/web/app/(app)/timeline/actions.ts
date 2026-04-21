"use server";

import { headers, cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { summarizeDailyReviews } from "@/lib/summarizer";
import { formatWeekLabel, getSundayOfWeek } from "./week-helpers";
import type { TimelineWeek, TimelineDay } from "@/components/timeline";

// ── Shared query helper ───────────────────────────────────────

export async function getWeekData(
  orgId: string,
  weekStart: Date,
  weekEnd: Date
): Promise<TimelineWeek> {
  const now = new Date();
  const monday = new Date(weekStart);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(weekEnd);
  sunday.setHours(23, 59, 59, 999);

  const prs = await prisma.pullRequest.findMany({
    where: {
      repository: { organizationId: orgId },
      updatedAt: { gte: monday, lte: sunday },
    },
    select: {
      number: true,
      title: true,
      url: true,
      author: true,
      status: true,
      updatedAt: true,
      repository: { select: { fullName: true, provider: true } },
      reviewIssues: {
        select: {
          id: true,
          title: true,
          severity: true,
          filePath: true,
          lineNumber: true,
          linearIssueId: true,
          linearIssueUrl: true,
          jiraIssueKey: true,
          jiraIssueUrl: true,
          githubIssueNumber: true,
          githubIssueUrl: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Group by day
  const today = now.toISOString().split("T")[0];
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  const dayMap = new Map<
    string,
    {
      items: TimelineDay["items"];
      authors: Set<string>;
      reviewed: number;
      findings: number;
    }
  >();

  for (const pr of prs) {
    const dateStr = pr.updatedAt.toISOString().split("T")[0];
    const entry = dayMap.get(dateStr) ?? {
      items: [],
      authors: new Set<string>(),
      reviewed: 0,
      findings: 0,
    };

    entry.items.push({
      repoName: pr.repository.fullName,
      repoProvider: pr.repository.provider,
      prNumber: pr.number,
      prTitle: pr.title,
      prUrl: pr.url,
      author: pr.author,
      status: pr.status,
      time: pr.updatedAt.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
      issues: pr.reviewIssues.map((ri) => ({
        id: ri.id,
        title: ri.title,
        severity: ri.severity,
        filePath: ri.filePath,
        lineNumber: ri.lineNumber,
        linearIssueId: ri.linearIssueId,
        linearIssueUrl: ri.linearIssueUrl,
        jiraIssueKey: ri.jiraIssueKey,
        jiraIssueUrl: ri.jiraIssueUrl,
        githubIssueNumber: ri.githubIssueNumber,
        githubIssueUrl: ri.githubIssueUrl,
        repoProvider: pr.repository.provider,
      })),
    });

    entry.authors.add(pr.author);
    if (pr.status === "completed") entry.reviewed++;
    entry.findings += pr.reviewIssues.length;

    dayMap.set(dateStr, entry);
  }

  function getDayLabel(dateStr: string): string {
    if (dateStr === today) return "Today";
    if (dateStr === yesterdayStr) return "Yesterday";
    const d = new Date(dateStr + "T00:00:00");
    return dayNames[d.getDay()];
  }

  const days: TimelineDay[] = Array.from(dayMap.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dateStr, data]) => ({
      date: dateStr,
      label: getDayLabel(dateStr),
      contributors: data.authors.size,
      prsReviewed: data.reviewed,
      findings: data.findings,
      items: data.items,
    }));

  const weekKey = monday.toISOString().split("T")[0];
  const totalAuthors = new Set(prs.map((p) => p.author));

  return {
    weekKey,
    label: formatWeekLabel(monday, now),
    weekStart: weekKey,
    weekEnd: sunday.toISOString().split("T")[0],
    totalPrs: prs.length,
    totalReviewed: prs.filter((p) => p.status === "completed").length,
    totalContributors: totalAuthors.size,
    totalFindings: prs.reduce((sum, p) => sum + p.reviewIssues.length, 0),
    days,
  };
}

// ── Server Actions ────────────────────────────────────────────

export async function loadWeek(weekStartISO: string): Promise<TimelineWeek> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) throw new Error("Unauthorized");

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;

  const member = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      ...(currentOrgId ? { organizationId: currentOrgId } : {}),
      deletedAt: null,
    },
    select: { organizationId: true },
  });
  if (!member) throw new Error("No organization");

  const monday = new Date(weekStartISO + "T00:00:00");
  const sunday = getSundayOfWeek(monday);

  return getWeekData(member.organizationId, monday, sunday);
}

export async function getDaySummary(
  date: string
): Promise<{ summary: string; prCount: number } | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) throw new Error("Unauthorized");

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;

  const member = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      ...(currentOrgId ? { organizationId: currentOrgId } : {}),
      deletedAt: null,
    },
    select: { organizationId: true },
  });
  if (!member) throw new Error("No organization");

  const existing = await prisma.daySummary.findUnique({
    where: {
      organizationId_date: {
        organizationId: member.organizationId,
        date,
      },
    },
    select: { summary: true, prCount: true },
  });

  return existing;
}

export async function generateDailySummary(date: string): Promise<string> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) throw new Error("Unauthorized");

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;

  const member = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      ...(currentOrgId ? { organizationId: currentOrgId } : {}),
      deletedAt: null,
    },
    select: { organizationId: true },
  });

  if (!member) throw new Error("No organization");

  const dayStart = new Date(date + "T00:00:00Z");
  const dayEnd = new Date(date + "T23:59:59.999Z");

  const prs = await prisma.pullRequest.findMany({
    where: {
      repository: { organizationId: member.organizationId },
      status: "completed",
      updatedAt: { gte: dayStart, lte: dayEnd },
    },
    select: {
      number: true,
      title: true,
      author: true,
      reviewBody: true,
      repository: { select: { fullName: true } },
    },
  });

  if (prs.length === 0) {
    return "No completed reviews for this day.";
  }

  const reviews = prs
    .filter((pr) => pr.reviewBody)
    .map((pr) => ({
      repo: pr.repository.fullName,
      prNumber: pr.number,
      title: pr.title,
      author: pr.author,
      reviewBody: pr.reviewBody!,
    }));

  if (reviews.length === 0) {
    return "Reviews are pending — no completed review bodies yet.";
  }

  const summary = await summarizeDailyReviews(reviews, member.organizationId);

  // Save to DB (upsert so re-summarize overwrites)
  await prisma.daySummary.upsert({
    where: {
      organizationId_date: {
        organizationId: member.organizationId,
        date,
      },
    },
    create: {
      organizationId: member.organizationId,
      date,
      summary,
      prCount: prs.length,
    },
    update: {
      summary,
      prCount: prs.length,
    },
  });

  return summary;
}
