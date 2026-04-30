"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { pubby } from "@/lib/pubby";
import { createAnalysisAbortController, abortAnalysis, clearAnalysisAbortController } from "@/lib/analysis-abort";
import { eventBus } from "@/lib/events/bus";

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
  (async () => {
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
  })();

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
  return {};
}

export async function toggleFavoriteRepository(
  repoId: string,
): Promise<{ favorited: boolean; error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

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

  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: {
      id: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { role: true },
          },
        },
      },
    },
  });

  if (!repo || repo.organization.members.length === 0) {
    return { error: "Repository not found." };
  }

  if (repo.organization.members[0].role !== "owner") {
    return { error: "Only organization owners can change model settings." };
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

  if (!repoId || !targetOrgId) {
    return { error: "Missing required fields." };
  }

  // Verify repo exists and user is owner of the source org
  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: {
      id: true,
      fullName: true,
      organizationId: true,
      indexStatus: true,
      organization: {
        select: {
          id: true,
          name: true,
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { role: true },
          },
        },
      },
    },
  });

  if (!repo || repo.organization.members.length === 0) {
    return { error: "Repository not found." };
  }

  if (repo.organization.members[0].role !== "owner") {
    return { error: "Only organization owners can transfer repositories." };
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

  // Transfer the repository
  await prisma.repository.update({
    where: { id: repoId },
    data: { organizationId: targetOrgId },
  });

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

export async function toggleAutoReview(
  repoId: string,
  enabled: boolean,
): Promise<{ error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

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

  if (!repo || repo.organization.members.length === 0) return {};

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
    confidenceThreshold?: string;
    enableTwoPassReview?: boolean;
  },
): Promise<{ error?: string; success?: boolean }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: {
      id: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { role: true },
          },
        },
      },
    },
  });

  if (!repo || repo.organization.members.length === 0) {
    return { error: "Repository not found." };
  }

  if (repo.organization.members[0].role !== "owner") {
    return { error: "Only organization owners can change review config." };
  }

  // Validate config values
  if (config.maxFindings !== undefined && (config.maxFindings < 1 || config.maxFindings > 50)) {
    return { error: "Max findings must be between 1 and 50." };
  }
  if (config.inlineThreshold && !["critical", "high", "medium"].includes(config.inlineThreshold)) {
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
  const { normalizeRepoConfigFiles, DEFAULT_REPO_CONFIG_FILES } = await import("@/lib/repo-config-shared");
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: {
      id: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { role: true },
          },
        },
      },
    },
  });

  if (!repo || repo.organization.members.length === 0) {
    return { error: "Repository not found." };
  }
  if (repo.organization.members[0].role !== "owner") {
    return { error: "Only organization owners can change repo config settings." };
  }

  if (input.useRepoConfig && input.repoConfigFiles.length === 0) {
    return { error: "Add at least one filename, or disable repo config." };
  }

  const cleaned = normalizeRepoConfigFiles(input.repoConfigFiles);
  if (input.useRepoConfig && cleaned.length === 0) {
    return { error: "All provided filenames are invalid." };
  }

  await prisma.repository.update({
    where: { id: repoId },
    data: {
      useRepoConfig: input.useRepoConfig,
      repoConfigFiles: input.useRepoConfig ? cleaned : DEFAULT_REPO_CONFIG_FILES,
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
