"use server";

import "server-only";
import { isActionId } from "@/lib/action-input";
import { isBoundedStringArray } from "@/lib/bounded-json";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { hasOrgPermission } from "@/lib/org-permissions";
import { pubby } from "@/lib/pubby";
import { createAnalysisAbortController, abortAnalysis, clearAnalysisAbortController } from "@/lib/analysis-abort";
import { abortIndexing } from "@/lib/indexing-abort";
import { eventBus } from "@/lib/events/bus";
import { trackInline } from "@/lib/queue-drain-worker";
import { syncForgejoRepos } from "@/lib/repo-sync";

export type RepoDetailData = {
  contributors: { login: string; avatarUrl: string; contributions: number }[];
  summary: string | null;
  purpose: string | null;
  analysis: string | null;
  pullRequests: {
    id: string;
    number: number;
    title: string;
    url: string;
    author: string;
    status: string;
    reviewBody: string | null;
    mergedAt: string | null;
    createdAt: string;
  }[];
};

export async function getRepoDetail(repoId: string): Promise<RepoDetailData | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) return null;
  if (!isActionId(repoId)) return null;

  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: {
      id: true,
      contributors: true,
      summary: true,
      purpose: true,
      analysis: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { id: true },
          },
        },
      },
      pullRequests: {
        where: { status: { in: ["pending", "reviewing", "completed"] } },
        select: {
          id: true,
          number: true,
          title: true,
          url: true,
          author: true,
          status: true,
          reviewBody: true,
          mergedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

  if (!repo || repo.organization.members.length === 0) return null;

  return {
    contributors: repo.contributors as { login: string; avatarUrl: string; contributions: number }[],
    summary: repo.summary,
    purpose: repo.purpose,
    analysis: repo.analysis,
    pullRequests: repo.pullRequests.map((pr) => ({
      ...pr,
      reviewBody: pr.reviewBody ?? null,
      mergedAt: pr.mergedAt?.toISOString() ?? null,
      createdAt: pr.createdAt.toISOString(),
    })),
  };
}

const ANALYSIS_COOLDOWN_MS = 120_000; // 2 minutes
const STALE_ANALYSIS_MS = 10 * 60 * 1000; // 10 minutes

export async function analyzeRepository(
  repoId: string,
): Promise<{ error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");
  if (!isActionId(repoId)) return { error: "Invalid repository ID." };

  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: {
      id: true,
      fullName: true,
      indexStatus: true,
      analysisStatus: true,
      analyzedAt: true,
      organizationId: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!repo || repo.organization.members.length === 0) return {};

  if (repo.indexStatus !== "indexed") {
    return { error: "Repository must be indexed before analysis." };
  }

  // If stuck in "analyzing" for more than 10 minutes, reset to allow re-trigger
  if (repo.analysisStatus === "analyzing") {
    const updated = await prisma.repository.updateMany({
      where: {
        id: repoId,
        analysisStatus: "analyzing",
        updatedAt: { lt: new Date(Date.now() - STALE_ANALYSIS_MS) },
      },
      data: { analysisStatus: "none" },
    });

    if (updated.count === 0) {
      return { error: "Analysis is already in progress." };
    }

    console.warn(
      `[analyzeRepository] Stale analysis detected for repo ${repoId}. Resetting status to allow re-trigger.`
    );
  }

  if (repo.analyzedAt) {
    const elapsed = Date.now() - repo.analyzedAt.getTime();
    if (elapsed < ANALYSIS_COOLDOWN_MS) {
      const remaining = Math.ceil((ANALYSIS_COOLDOWN_MS - elapsed) / 1000);
      return { error: `Please wait ${remaining}s before re-analyzing.` };
    }
  }

  const channel = `presence-org-${repo.organizationId}`;
  const abortController = createAnalysisAbortController(repoId);

  const emitLog = (message: string, level: "info" | "success" | "error" | "warning" = "info") => {
    pubby.trigger(channel, "analysis-log", {
      repoId: repo.id,
      message,
      level,
      timestamp: Date.now(),
    });
  };

  await prisma.repository.update({
    where: { id: repoId },
    data: { analysisStatus: "analyzing" },
  });

  pubby.trigger(channel, "analysis-status", {
    repoId: repo.id,
    status: "analyzing",
  });

  // Fire-and-forget: don't await so navigation isn't blocked.
  // Results are pushed via Pubby real-time events.
  void trackInline(async () => {
    try {
      emitLog(`Starting analysis for ${repo.fullName}...`);
      const { analyzeRepository: runAnalysis } = await import("@/lib/analyzer");
      const analysis = await runAnalysis(repo.id, repo.fullName, repo.organizationId, emitLog, abortController.signal);

      await prisma.repository.update({
        where: { id: repoId },
        data: {
          analysis,
          analysisStatus: "analyzed",
          analyzedAt: new Date(),
        },
      });

      clearAnalysisAbortController(repoId);
      emitLog("Analysis completed successfully", "success");

      pubby.trigger(channel, "analysis-status", {
        repoId: repo.id,
        status: "analyzed",
      });

      eventBus.emit({
        type: "repo-analyzed",
        orgId: repo.organizationId,
        repoFullName: repo.fullName,
      });
    } catch (error) {
      const isCancelled = abortController.signal.aborted;
      clearAnalysisAbortController(repoId);

      if (isCancelled) {
        emitLog("Analysis cancelled by user", "warning");
        await prisma.repository.update({
          where: { id: repoId },
          data: { analysisStatus: "none" },
        });
        pubby.trigger(channel, "analysis-status", {
          repoId: repo.id,
          status: "none",
        });
      } else {
        console.error(`Failed to analyze repo ${repo.fullName}:`, error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        emitLog(`Analysis failed: ${errorMsg}`, "error");

        await prisma.repository.update({
          where: { id: repoId },
          data: { analysisStatus: "failed" },
        });
        pubby.trigger(channel, "analysis-status", {
          repoId: repo.id,
          status: "failed",
        });
      }
    }
  });

  revalidatePath("/repositories");
  return {};
}

export async function cancelAnalysis(
  repoId: string,
): Promise<{ error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");
  if (!isActionId(repoId)) return { error: "Invalid repository ID." };

  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: {
      id: true,
      analysisStatus: true,
      organizationId: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!repo || repo.organization.members.length === 0) return {};

  if (repo.analysisStatus !== "analyzing") {
    return { error: "Repository is not currently being analyzed." };
  }

  abortAnalysis(repoId);

  await prisma.repository.update({
    where: { id: repoId },
    data: { analysisStatus: "none" },
  });
  pubby.trigger(`presence-org-${repo.organizationId}`, "analysis-status", {
    repoId,
    status: "none",
  });
  revalidatePath("/repositories");
  return {};
}

export async function toggleFavoriteRepository(
  repoId: string,
): Promise<{ favorited: boolean; error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");
  if (!isActionId(repoId)) return { favorited: false, error: "Invalid repository ID." };

  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: {
      id: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!repo || repo.organization.members.length === 0) {
    return { favorited: false, error: "Repository not found" };
  }

  const existing = await prisma.favoriteRepository.findUnique({
    where: {
      userId_repositoryId: {
        userId: session.user.id,
        repositoryId: repoId,
      },
    },
  });

  if (existing) {
    await prisma.favoriteRepository.delete({
      where: { id: existing.id },
    });
    return { favorited: false };
  }

  await prisma.favoriteRepository.create({
    data: {
      userId: session.user.id,
      repositoryId: repoId,
    },
  });

  return { favorited: true };
}

export async function deletePullRequestReview(
  pullRequestId: string,
): Promise<{ error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");
  if (!isActionId(pullRequestId)) return { error: "Invalid pull request ID." };

  const pr = await prisma.pullRequest.findUnique({
    where: { id: pullRequestId },
    select: {
      id: true,
      repository: {
        select: {
          organizationId: true,
          organization: {
            select: {
              members: {
                where: { userId: session.user.id, deletedAt: null },
                select: { id: true },
              },
            },
          },
        },
      },
    },
  });

  if (!pr || pr.repository.organization.members.length === 0) {
    return { error: "Pull request not found" };
  }

  // Delete from Qdrant (review + diagram chunks)
  const { deleteReviewChunksByPR } = await import("@/lib/qdrant");
  const { deleteDiagramChunksByPR } = await import("@/lib/qdrant");
  await Promise.all([
    deleteReviewChunksByPR(pullRequestId),
    deleteDiagramChunksByPR(pullRequestId),
  ]);

  // Delete review issues, then the PR itself from DB
  await prisma.reviewIssue.deleteMany({
    where: { pullRequestId },
  });
  await prisma.pullRequest.delete({
    where: { id: pullRequestId },
  });

  revalidatePath("/repositories");
  return {};
}

export async function cancelPullRequestReview(
  pullRequestId: string,
): Promise<{ error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");
  if (!isActionId(pullRequestId)) return { error: "Invalid pull request ID." };

  const pr = await prisma.pullRequest.findUnique({
    where: { id: pullRequestId },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      headSha: true,
      repository: {
        select: {
          fullName: true,
          installationId: true,
          provider: true,
          organizationId: true,
          organization: {
            select: {
              githubInstallationId: true,
              members: {
                where: { userId: session.user.id, deletedAt: null },
                select: { id: true },
              },
            },
          },
        },
      },
    },
  });

  if (!pr || pr.repository.organization.members.length === 0) {
    return { error: "Pull request not found" };
  }

  if (pr.status !== "reviewing" && pr.status !== "pending") {
    return { error: "Review is not in progress" };
  }

  // Update PR status to failed — use conditional where to avoid race condition
  try {
    await prisma.pullRequest.update({
      where: {
        id: pr.id,
        status: { in: ["reviewing", "pending"] },
      },
      data: {
        status: "failed",
        errorMessage: "Review cancelled by user",
      },
    });
  } catch {
    // Status already changed (race condition) — not an error
    return { error: "Review status has already changed" };
  }

  // Update GitHub check run if applicable
  const installationId =
    pr.repository.installationId ?? pr.repository.organization.githubInstallationId;

  if (pr.headSha && pr.repository.provider === "github" && installationId) {
    try {
      const [owner, repo] = pr.repository.fullName.split("/");
      const { getInstallationToken } = await import("@/lib/github");

      const token = await getInstallationToken(installationId);

      // List check runs for this commit to find the in-progress one
      const listRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/commits/${pr.headSha}/check-runs`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
          },
        },
      );

      if (listRes.ok) {
        const data = await listRes.json();
        const octopusRun = data.check_runs?.find(
          (cr: { name: string; status: string }) =>
            cr.name === "Octopus Review" && cr.status === "in_progress",
        );

        if (octopusRun) {
          await fetch(
            `https://api.github.com/repos/${owner}/${repo}/check-runs/${octopusRun.id}`,
            {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
              },
              body: JSON.stringify({
                status: "completed",
                conclusion: "cancelled",
                completed_at: new Date().toISOString(),
                output: {
                  title: "Review Cancelled",
                  summary: `Review cancelled by ${session.user.name ?? session.user.email}.`,
                },
              }),
            },
          );
        }
      }
    } catch (e) {
      console.error("[cancel-review] Failed to update GitHub check run:", e);
    }
  }

  revalidatePath("/repositories");
  return {};
}

export async function updateRepoModels(
  repoId: string,
  reviewModelId: string | null,
  embedModelId: string | null,
): Promise<{ error?: string; success?: boolean }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");
  if (!isActionId(repoId)) return { error: "Invalid repository ID." };
  if ((reviewModelId !== null && !isActionId(reviewModelId)) || (embedModelId !== null && !isActionId(embedModelId))) return { error: "Invalid model selection." };

  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: {
      id: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { role: true, scopes: true },
          },
        },
      },
    },
  });

  if (!repo || repo.organization.members.length === 0) {
    return { error: "Repository not found." };
  }

  if (!hasOrgPermission(repo.organization.members[0], "repos:manage")) {
    return { error: "Only organization owners and admins can change model settings." };
  }

  await prisma.repository.update({
    where: { id: repoId },
    data: { reviewModelId, embedModelId },
  });

  revalidatePath("/settings/models");
  revalidatePath("/repositories");
  return { success: true };
}

export async function transferRepository(
  repoId: string,
  targetOrgId: string,
): Promise<{ error?: string; success?: boolean }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");
  if (!isActionId(repoId)) return { error: "Invalid repository ID." };
  if (!isActionId(targetOrgId)) return { error: "Invalid target organization." };

  // Verify repo exists and user is owner of the source org
  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: {
      id: true,
      provider: true,
      fullName: true,
      organizationId: true,
      indexStatus: true,
      organization: {
        select: {
          id: true,
          name: true,
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { role: true, scopes: true },
          },
        },
      },
    },
  });

  if (!repo || repo.organization.members.length === 0) {
    return { error: "Repository not found." };
  }

  if (!hasOrgPermission(repo.organization.members[0], "repos:manage")) {
    return { error: "Only organization owners and admins can transfer repositories." };
  }
  if (repo.provider === "forgejo") {
    return { error: "Connect Forgejo and sync this repository in the target organization. Forgejo connections and review history cannot be transferred between organizations." };
  }

  if (repo.organizationId === targetOrgId) {
    return { error: "Repository is already in this organization." };
  }

  if (repo.indexStatus === "indexing") {
    return { error: "Cannot transfer while indexing is in progress." };
  }

  // Verify user is a member of the target org
  const targetMember = await prisma.organizationMember.findFirst({
    where: {
      organizationId: targetOrgId,
      userId: session.user.id,
      deletedAt: null,
      organization: { deletedAt: null, bannedAt: null },
    },
    select: { role: true, organization: { select: { name: true } } },
  });

  if (!targetMember) {
    return { error: "You are not a member of the target organization." };
  }

  const transferred = await prisma.$transaction(async tx => {
    const [current] = await tx.$queryRaw<Array<{ organizationId: string; provider: string; indexStatus: string }>>`
      SELECT "organizationId", provider, "indexStatus" FROM repositories WHERE id = ${repoId} FOR UPDATE
    `;
    if (!current || current.organizationId !== repo.organizationId || current.provider !== repo.provider || current.indexStatus === "indexing") return false;
    const members = await tx.$queryRaw<Array<{ organizationId: string; role: string; scopes: string[] }>>`
      SELECT "organizationId", role, scopes FROM organization_members
      WHERE "userId" = ${session.user.id} AND "organizationId" IN (${repo.organizationId}, ${targetOrgId}) AND "deletedAt" IS NULL
      ORDER BY id FOR SHARE
    `;
    if (!hasOrgPermission(members.find(member => member.organizationId === repo.organizationId), "repos:manage") ||
        !members.some(member => member.organizationId === targetOrgId)) return false;
    const [target] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organizations WHERE id = ${targetOrgId} AND "deletedAt" IS NULL AND "bannedAt" IS NULL FOR SHARE
    `;
    if (!target) return false;
    await tx.repository.update({ where: { id: repoId }, data: { organizationId: targetOrgId } });
    return true;
  });
  if (!transferred) return { error: "Repository or permissions changed. Refresh and try again." };

  // Notify both orgs via Pubby
  const sourceChannel = `presence-org-${repo.organizationId}`;
  const targetChannel = `presence-org-${targetOrgId}`;

  pubby.trigger(sourceChannel, "repo-transferred", {
    repoId: repo.id,
    repoName: repo.fullName,
    targetOrgName: targetMember.organization.name,
    direction: "out",
  });

  pubby.trigger(targetChannel, "repo-transferred", {
    repoId: repo.id,
    repoName: repo.fullName,
    sourceOrgName: repo.organization.name,
    direction: "in",
  });

  revalidatePath("/repositories");
  return { success: true };
}

export async function removeRepository(
  repoId: string,
): Promise<{ error?: string; success?: boolean }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");
  if (!isActionId(repoId)) return { error: "Invalid repository ID." };

  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: {
      id: true,
      fullName: true,
      organizationId: true,
      indexStatus: true,
      indexAttemptId: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { role: true, scopes: true },
          },
        },
      },
    },
  });

  if (!repo || repo.organization.members.length === 0) {
    return { error: "Repository not found." };
  }

  if (!hasOrgPermission(repo.organization.members[0], "repos:manage")) {
    return { error: "Only organization owners and admins can remove repositories." };
  }

  abortAnalysis(repoId);
  if (repo.indexAttemptId) abortIndexing(repo.indexAttemptId);

  await prisma.repository.update({
    where: { id: repoId },
    data: {
      isActive: false,
      autoReview: false,
      dismissedAt: new Date(),
      indexStatus: repo.indexStatus === "indexing" ? "cancelled" : repo.indexStatus,
    },
  });

  pubby.trigger(`presence-org-${repo.organizationId}`, "repo-removed", {
    repoId: repo.id,
    repoName: repo.fullName,
  });

  revalidatePath("/repositories");
  return { success: true };
}

export async function restoreRepository(
  repoId: string,
): Promise<{ error?: string; success?: boolean }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");
  if (!isActionId(repoId)) return { error: "Invalid repository ID." };

  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: {
      id: true,
      provider: true,
      externalId: true,
      fullName: true,
      dismissedAt: true,
      organizationId: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { role: true, scopes: true },
          },
        },
      },
    },
  });

  if (!repo || repo.organization.members.length === 0) {
    return { error: "Repository not found." };
  }

  if (!hasOrgPermission(repo.organization.members[0], "repos:manage")) {
    return { error: "Only organization owners and admins can restore repositories." };
  }

  if (!repo.dismissedAt) {
    return { error: "Repository is not removed." };
  }

  if (repo.provider === "forgejo") {
    const integration = await prisma.forgejoIntegration.findUnique({ where: { organizationId: repo.organizationId }, select: { forgejoHost: true } });
    if (!integration || !repo.externalId.startsWith(`${integration.forgejoHost}:`)) {
      return { error: "Reconnect this repository's Forgejo instance before restoring it." };
    }
    // Only a current successful provider listing can reactivate a Forgejo row.
    await prisma.repository.update({ where: { id: repoId }, data: { dismissedAt: null, isActive: false } });
    try {
      await syncForgejoRepos(repo.organizationId, { source: "manual" });
      const restored = await prisma.repository.findUnique({ where: { id: repoId }, select: { isActive: true } });
      if (!restored?.isActive) throw new Error("Repository unavailable");
    } catch {
      await prisma.repository.updateMany({ where: { id: repoId, isActive: false }, data: { dismissedAt: repo.dismissedAt } });
      revalidatePath("/repositories");
      return { error: "Could not restore this Forgejo repository. Check that the connected account still administers it, then try again." };
    }
    revalidatePath("/repositories");
    return { success: true };
  }

  await prisma.repository.update({
    where: { id: repoId },
    data: {
      isActive: true,
      dismissedAt: null,
    },
  });

  pubby.trigger(`presence-org-${repo.organizationId}`, "repo-restored", {
    repoId: repo.id,
    repoName: repo.fullName,
  });

  revalidatePath("/repositories");
  return { success: true };
}

export async function toggleAutoReview(
  repoId: string,
  enabled: boolean,
): Promise<{ error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");
  if (!isActionId(repoId)) return { error: "Invalid repository ID." };
  if (typeof enabled !== "boolean") return { error: "Invalid auto-review setting." };

  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: {
      id: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { role: true, scopes: true },
          },
        },
      },
    },
  });

  if (!repo || repo.organization.members.length === 0) return { error: "Repository not found." };

  // Previously ungated (any member) — inconsistent with every sibling repo
  // action; auto-review on/off is review configuration.
  if (!hasOrgPermission(repo.organization.members[0], "reviews:configure")) {
    return { error: "Only organization owners and admins can toggle auto-review." };
  }

  await prisma.repository.update({
    where: { id: repoId },
    data: { autoReview: enabled },
  });

  revalidatePath("/repositories");
  return {};
}

export async function updateReviewConfig(
  repoId: string,
  config: {
    maxFindings?: number;
    inlineThreshold?: string;
    enableConflictDetection?: boolean;
    disabledCategories?: string[];
    confidenceThreshold?: string | number;
    enableTwoPassReview?: boolean;
  },
): Promise<{ error?: string; success?: boolean }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");
  if (!isActionId(repoId)) return { error: "Invalid repository ID." };
  if (!config || typeof config !== "object" || Array.isArray(config) ||
      (Object.getPrototypeOf(config) !== Object.prototype && Object.getPrototypeOf(config) !== null) ||
      Object.keys(config).some((key) => !["maxFindings", "inlineThreshold", "enableConflictDetection", "disabledCategories", "confidenceThreshold", "enableTwoPassReview"].includes(key)) ||
      (config.enableConflictDetection !== undefined && typeof config.enableConflictDetection !== "boolean") ||
      (config.enableTwoPassReview !== undefined && typeof config.enableTwoPassReview !== "boolean") ||
      (config.disabledCategories !== undefined && !isBoundedStringArray(config.disabledCategories, 100, 128))) {
    return { error: "Invalid review config." };
  }

  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: {
      id: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { role: true, scopes: true },
          },
        },
      },
    },
  });

  if (!repo || repo.organization.members.length === 0) {
    return { error: "Repository not found." };
  }

  if (!hasOrgPermission(repo.organization.members[0], "reviews:configure")) {
    return { error: "Only organization owners and admins can change review config." };
  }

  // Validate config values
  if (config.maxFindings !== undefined && (typeof config.maxFindings !== "number" || !Number.isInteger(config.maxFindings) || config.maxFindings < 1 || config.maxFindings > 50)) {
    return { error: "Max findings must be between 1 and 50." };
  }
  if (config.inlineThreshold !== undefined && !["critical", "high", "medium", "low"].includes(config.inlineThreshold)) {
    return { error: "Invalid inline threshold." };
  }
  if (config.confidenceThreshold !== undefined) {
    const ct = config.confidenceThreshold;
    const isValidString = typeof ct === "string" && ["HIGH", "MEDIUM"].includes(ct);
    const isValidNumber = typeof ct === "number" && ct >= 0 && ct <= 100;
    if (!isValidString && !isValidNumber) {
      return { error: "Invalid confidence threshold." };
    }
  }

  await prisma.repository.update({
    where: { id: repoId },
    data: { reviewConfig: config },
  });

  revalidatePath("/repositories");
  return { success: true };
}

export async function updateRepoConfigSettings(
  repoId: string,
  input: {
    useRepoConfig: boolean;
    repoConfigFiles: string[];
  },
): Promise<{ error?: string; success?: boolean }> {
  const { normalizeRepoConfigFiles } = await import("@/lib/repo-config-shared");
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");
  if (!isActionId(repoId)) return { error: "Invalid repository ID." };
  if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.useRepoConfig !== "boolean" || !isBoundedStringArray(input.repoConfigFiles, 100, 1024)) return { error: "Invalid repo config settings." };

  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: {
      id: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { role: true, scopes: true },
          },
        },
      },
    },
  });

  if (!repo || repo.organization.members.length === 0) {
    return { error: "Repository not found." };
  }
  if (!hasOrgPermission(repo.organization.members[0], "reviews:configure")) {
    return { error: "Only organization owners and admins can change repo config settings." };
  }

  if (input.useRepoConfig && input.repoConfigFiles.length === 0) {
    return { error: "Add at least one filename, or disable repo config." };
  }

  const cleaned = normalizeRepoConfigFiles(input.repoConfigFiles);
  if (input.useRepoConfig && cleaned.length === 0) {
    return { error: "All provided filenames are invalid." };
  }

  // Always persist the user-provided filename list, even when disabling, so
  // the user's custom filenames (e.g. AJAN.md) are still there next time they
  // re-enable. The list is only consulted when useRepoConfig is true.
  await prisma.repository.update({
    where: { id: repoId },
    data: {
      useRepoConfig: input.useRepoConfig,
      repoConfigFiles: cleaned,
    },
  });

  revalidatePath(`/repositories/${repoId}/settings`);
  return { success: true };
}

export async function getReviewConfig(
  repoId: string,
): Promise<Record<string, unknown> | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) return null;
  if (!isActionId(repoId)) return null;

  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: {
      reviewConfig: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!repo || repo.organization.members.length === 0) return null;
  return (repo.reviewConfig as Record<string, unknown>) ?? {};
}
