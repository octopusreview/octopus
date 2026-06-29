/**
 * OSS bot-account review trigger.
 *
 * Called by the Octopus GitHub Action running in "trigger" mode — a workflow that grants
 * NO permissions and holds no write token. The action only tells us which PR to review;
 * the server fetches the diff, runs the review, and posts it as a shared GitHub bot user
 * account (comment-only by GitHub's permission model). Consent is gated on the repo's
 * .github/octopus.yml file, so a spoofed trigger can never make the bot comment on a repo
 * whose maintainers didn't opt in.
 */

import { prisma } from "@octopus/db";
import { ORG_TYPE } from "@/lib/org-types";
import { getRepositoryDetails } from "@/lib/github";
import { getBotToken, hasConsentFile, isBotAccountConfigured } from "@/lib/oss-bot";
import { enqueue } from "@/lib/queue";
import { NextRequest } from "next/server";

const GITHUB_API = "https://api.github.com";
const COMMUNITY_JOB_TTL_HOURS = 25;

const LOG = (msg: string, ...rest: unknown[]) => console.log(`[oss-review] ${msg}`, ...rest);
const ERR = (msg: string, ...rest: unknown[]) => console.error(`[oss-review] ${msg}`, ...rest);

async function getOrCreateCommunityOrg(githubOwner: string) {
  const slug = `community-${githubOwner.toLowerCase()}`;
  return prisma.organization.upsert({
    where: { slug },
    create: {
      name: `${githubOwner} (Community)`,
      slug,
      type: ORG_TYPE.COMMUNITY,
      freeCreditBalance: 0,
    },
    update: { type: ORG_TYPE.COMMUNITY },
  });
}

/** Confirm the PR exists and is open (anti-spoof: never review closed/nonexistent PRs). */
async function fetchOpenPr(
  botToken: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ headSha: string; title: string; author: string; baseBranch: string } | null> {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}`, {
    headers: { Authorization: `Bearer ${botToken}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.state !== "open") return null;
  return {
    headSha: data.head?.sha ?? "",
    title: data.title ?? "",
    author: data.user?.login ?? "unknown",
    baseBranch: data.base?.ref ?? "main",
  };
}

export async function POST(request: NextRequest) {
  if (!isBotAccountConfigured()) {
    return Response.json({ error: "Bot-account review mode is not configured" }, { status: 503 });
  }
  const botToken = getBotToken();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const owner = typeof body.owner === "string" ? body.owner : undefined;
  const repoName = typeof body.repo === "string" ? body.repo : undefined;
  const prNumber = typeof body.prNumber === "number" ? body.prNumber : undefined;

  if (!owner || !repoName || prNumber == null) {
    return Response.json({ error: "Missing required fields: owner, repo, prNumber" }, { status: 400 });
  }

  const fullName = `${owner}/${repoName}`;

  // ── Cheap guards first (no GitHub API): allowlist + rate limit ──────────────
  // The endpoint is unauthenticated (fork PRs have no secret to sign with), so abuse is
  // bounded here, before any GitHub API call: an unapproved repo is rejected on a single
  // indexed DB lookup. A repo must be manually approved AND carry the consent file.
  const approved = await prisma.ossReviewAllowlist.findUnique({
    where: { repoFullName: fullName.toLowerCase() },
  });
  if (!approved) {
    LOG(`${fullName} not on the OSS review allowlist — ignoring`);
    return Response.json({ status: "skipped", reason: "not-approved" });
  }

  const org = await getOrCreateCommunityOrg(owner);

  // Daily rate limit. Window is anchored to UTC midnight (not the server's local clock)
  // so it aligns with the UTC createdAt timestamps and doesn't drift across instances.
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const todayCount = await prisma.aiUsage.count({
    where: { organizationId: org.id, operation: "community-review", createdAt: { gte: startOfDay } },
  });
  if (todayCount >= org.communityDailyReviewLimit) {
    return Response.json({ status: "skipped", reason: "daily-limit-reached" });
  }

  // ── GitHub-touching checks (approved repos only) ────────────────────────────
  const repoInfo = await getRepositoryDetails(0, owner, repoName, botToken);
  if (!repoInfo) {
    return Response.json({ error: "Repository not found" }, { status: 404 });
  }
  if (repoInfo.private) {
    return Response.json({ error: "Bot-account mode is for public repositories only" }, { status: 400 });
  }

  const consented = await hasConsentFile(owner, repoName, repoInfo.default_branch, botToken);
  if (!consented) {
    LOG(`no consent file (.github/octopus.yml) for ${fullName} — ignoring`);
    return Response.json({ status: "skipped", reason: "no-consent-file" });
  }

  // ── PR must exist and be open ───────────────────────────────────────────────
  const pr = await fetchOpenPr(botToken, owner, repoName, prNumber);
  if (!pr) {
    return Response.json({ status: "skipped", reason: "pr-not-open" });
  }
  const headSha = pr.headSha;

  // ── Repo record ─────────────────────────────────────────────────────────────
  const externalId = String(repoInfo.id);
  const repo = await prisma.repository.upsert({
    where: {
      provider_externalId_organizationId: { provider: "github", externalId, organizationId: org.id },
    },
    create: {
      name: repoName,
      fullName,
      provider: "github",
      externalId,
      defaultBranch: repoInfo.default_branch,
      organizationId: org.id,
      isActive: true,
    },
    update: { defaultBranch: repoInfo.default_branch },
  });

  // ── Dedup: same repo + PR + headSha already in flight or recently done ───────
  const existing = await prisma.communityReviewJob.findFirst({
    where: {
      repositoryId: repo.id,
      prNumber,
      headSha,
      status: { in: ["indexing", "reviewing", "completed"] },
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    LOG(`dedup hit jobId=${existing.id} ${fullName}#${prNumber}@${headSha.slice(0, 8)}`);
    return Response.json({ status: "deduped", jobId: existing.id });
  }

  // ── Enqueue ─────────────────────────────────────────────────────────────────
  const expiresAt = new Date(Date.now() + COMMUNITY_JOB_TTL_HOURS * 60 * 60 * 1000);
  const job = await prisma.communityReviewJob.create({
    data: {
      status: "indexing",
      postMode: "bot_account",
      repoFullName: fullName,
      repositoryId: repo.id,
      organizationId: org.id,
      prNumber,
      prTitle: pr.title,
      prAuthor: pr.author,
      headSha,
      baseBranch: pr.baseBranch,
      diff: "", // fetched server-side by the worker via the bot token
      githubToken: null,
      expiresAt,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "oss_review.queued",
      category: "review",
      targetType: "community_review_job",
      targetId: job.id,
      organizationId: org.id,
      metadata: { repoFullName: fullName, prNumber, headSha },
    },
  }).catch((err) => ERR("audit log create failed (non-fatal):", err));

  await enqueue("community-review", { jobId: job.id });
  LOG(`queued jobId=${job.id} ${fullName}#${prNumber}@${headSha.slice(0, 8)}`);

  return Response.json({ status: "queued", jobId: job.id });
}
