"use server";

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { pubby } from "@/lib/pubby";
import { writeSyncLog, deleteSyncLogs } from "@/lib/elasticsearch";
import { listInstallationRepos } from "@/lib/github";
import { listWorkspaceRepos } from "@/lib/bitbucket";
import type { LogLevel } from "@/lib/indexer";
import { createAbortController, abortIndexing } from "@/lib/indexing-abort";
import { runIndexingInBackground } from "@/lib/indexing-runner";
import { toBaseSlug, randomSlugSuffix } from "@/lib/slug";

export async function clearOrgCookie() {
  const cookieStore = await cookies();
  cookieStore.delete("current_org_id");
}

async function getUser() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");
  return session.user;
}

export async function switchOrganization(orgId: string) {
  const user = await getUser();

  // Verify user is a member of this org
  const member = await prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId: user.id,
      deletedAt: null,
    },
  });

  if (!member) return;

  const cookieStore = await cookies();
  cookieStore.set("current_org_id", orgId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/");
}

export async function createOrganization(
  _prevState: { error?: string },
  formData: FormData,
): Promise<{ error?: string }> {
  const user = await getUser();
  const name = formData.get("name") as string;

  if (!name || name.trim().length < 2) {
    return { error: "Organization name must be at least 2 characters." };
  }

  const baseSlug = toBaseSlug(name);

  // Generate unique slug with random suffix (includes soft-deleted orgs)
  let slug = `${baseSlug}-${randomSlugSuffix()}`;
  for (let i = 0; i < 10; i++) {
    const existing = await prisma.organization.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!existing) break;
    slug = `${baseSlug}-${randomSlugSuffix()}`;
  }

  const org = await prisma.organization.create({
    data: {
      name: name.trim(),
      slug,
      members: {
        create: {
          userId: user.id,
          role: "owner",
        },
      },
      creditTransactions: {
        create: {
          amount: 150,
          type: "free_credit",
          description: "Welcome bonus — $150 free credits",
          balanceAfter: 150,
        },
      },
    },
  });

  const cookieStore = await cookies();
  cookieStore.set("current_org_id", org.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function updateOrganizationName(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const user = await getUser();
  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;

  if (!orgId) return { error: "No organization selected." };

  const member = await prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId: user.id,
      deletedAt: null,
    },
    select: { role: true },
  });

  if (!member || member.role !== "owner") {
    return { error: "Only organization owners can change the name." };
  }

  const name = (formData.get("name") as string)?.trim();
  if (!name || name.length < 2) {
    return { error: "Organization name must be at least 2 characters." };
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: { name },
  });

  revalidatePath("/");
  return { success: true };
}

export async function updateApiKeys(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const user = await getUser();
  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;

  if (!orgId) return { error: "No organization selected." };

  const member = await prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId: user.id,
      deletedAt: null,
    },
    select: { role: true },
  });

  if (!member || member.role !== "owner") {
    return { error: "Only organization owners can update API keys." };
  }

  const openaiApiKey = (formData.get("openaiApiKey") as string)?.trim() || null;
  const anthropicApiKey = (formData.get("anthropicApiKey") as string)?.trim() || null;
  const googleApiKey = (formData.get("googleApiKey") as string)?.trim() || null;
  const cohereApiKey = (formData.get("cohereApiKey") as string)?.trim() || null;

  if (openaiApiKey && !openaiApiKey.startsWith("sk-")) {
    return { error: "Invalid OpenAI API key format." };
  }

  if (anthropicApiKey && !anthropicApiKey.startsWith("sk-ant-")) {
    return { error: "Invalid Anthropic API key format." };
  }

  if (googleApiKey && !googleApiKey.startsWith("AIza")) {
    return { error: "Invalid Google AI API key format." };
  }

  // Only update keys that have new values — empty fields keep the existing key
  const data: Record<string, string | null> = {};
  if (openaiApiKey) data.openaiApiKey = openaiApiKey;
  if (anthropicApiKey) data.anthropicApiKey = anthropicApiKey;
  if (googleApiKey) data.googleApiKey = googleApiKey;
  if (cohereApiKey) data.cohereApiKey = cohereApiKey;

  if (Object.keys(data).length === 0) {
    return { error: "Enter at least one API key to save." };
  }

  await prisma.organization.update({
    where: { id: orgId },
    data,
  });

  revalidatePath("/settings");
  return { success: true };
}

const VALID_KEY_FIELDS = ["openaiApiKey", "anthropicApiKey", "googleApiKey", "cohereApiKey"] as const;

export async function removeApiKey(
  keyField: (typeof VALID_KEY_FIELDS)[number],
): Promise<{ error?: string; success?: boolean }> {
  if (!VALID_KEY_FIELDS.includes(keyField)) {
    return { error: "Invalid key field." };
  }

  const user = await getUser();
  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;

  if (!orgId) return { error: "No organization selected." };

  const member = await prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId: user.id,
      deletedAt: null,
    },
    select: { role: true },
  });

  if (!member || member.role !== "owner") {
    return { error: "Only organization owners can manage API keys." };
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: { [keyField]: null },
  });

  revalidatePath("/settings");
  return { success: true };
}

export async function updateDefaultModels(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const user = await getUser();
  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;

  if (!orgId) return { error: "No organization selected." };

  const member = await prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId: user.id,
      deletedAt: null,
    },
    select: { role: true },
  });

  if (!member || member.role !== "owner") {
    return { error: "Only organization owners can change default models." };
  }

  const defaultModelId = (formData.get("defaultModelId") as string)?.trim() || null;
  const defaultEmbedModelId = (formData.get("defaultEmbedModelId") as string)?.trim() || null;

  await prisma.organization.update({
    where: { id: orgId },
    data: { defaultModelId, defaultEmbedModelId },
  });

  revalidatePath("/settings/models");
  revalidatePath("/settings/api-keys");
  return { success: true };
}

export async function deleteOrganization(
  orgSlug: string,
  confirmPhrase: string,
): Promise<{ error?: string; logout?: boolean }> {
  const user = await getUser();
  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;

  if (!orgId) return { error: "No organization selected." };

  const member = await prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId: user.id,
      deletedAt: null,
    },
    select: {
      role: true,
      organization: { select: { slug: true } },
    },
  });

  if (!member || member.role !== "owner") {
    return { error: "Only organization owners can delete the organization." };
  }

  if (orgSlug !== member.organization.slug) {
    return { error: "Organization name does not match." };
  }

  if (confirmPhrase !== "delete my organization") {
    return { error: "Confirmation phrase does not match." };
  }

  // Check if this is the user's last active org BEFORE deleting
  const activeOrgCount = await prisma.organizationMember.count({
    where: {
      userId: user.id,
      deletedAt: null,
      organization: { deletedAt: null, bannedAt: null },
    },
  });
  const isLastOrg = activeOrgCount <= 1;

  // Soft-delete the organization
  await prisma.organization.update({
    where: { id: orgId },
    data: { deletedAt: new Date() },
  });

  // Soft-delete all members so they lose access
  await prisma.organizationMember.updateMany({
    where: { organizationId: orgId, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  if (isLastOrg) {
    // Last org deleted — signal client to logout
    cookieStore.delete("current_org_id");
    revalidatePath("/");
    return { logout: true };
  }

  // Find another active org for this user and switch
  const nextMembership = await prisma.organizationMember.findFirst({
    where: {
      userId: user.id,
      deletedAt: null,
      organization: { deletedAt: null, bannedAt: null },
    },
    select: { organizationId: true },
  });

  if (nextMembership) {
    cookieStore.set("current_org_id", nextMembership.organizationId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
  } else {
    cookieStore.delete("current_org_id");
  }

  revalidatePath("/");
  redirect("/dashboard");
}

// getUser() acts as an auth guard — throws if unauthenticated.
// The return value is intentionally discarded; org scoping uses cookie-based orgId below.
export async function syncRepos(): Promise<{ synced: number; removed: number; error?: string }> {
  await getUser();
  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;

  if (!orgId) return { synced: 0, removed: 0, error: "No organization selected." };

  // Collect all unique installationIds: org-level + repo-level
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { githubInstallationId: true },
  });

  const repoInstallations = await prisma.repository.findMany({
    where: { organizationId: orgId, installationId: { not: null } },
    select: { installationId: true },
    distinct: ["installationId"],
  });

  const installationIds = new Set<number>();
  if (org?.githubInstallationId) installationIds.add(org.githubInstallationId);
  for (const r of repoInstallations) {
    if (r.installationId) installationIds.add(r.installationId);
  }

  // Fetch repos from all GitHub installations
  let synced = 0;
  let removed = 0;
  const allGhRepoIds: string[] = [];

  if (installationIds.size > 0) {
    for (const instId of installationIds) {
      try {
        const ghRepos = await listInstallationRepos(instId);
        for (const repo of ghRepos) {
          const externalId = String(repo.id);
          allGhRepoIds.push(externalId);
          await prisma.repository.upsert({
            where: {
              provider_externalId: { provider: "github", externalId },
            },
            create: {
              name: repo.name,
              fullName: repo.full_name,
              externalId,
              defaultBranch: repo.default_branch,
              provider: "github",
              installationId: instId,
              organizationId: orgId,
            },
            update: {
              name: repo.name,
              fullName: repo.full_name,
              defaultBranch: repo.default_branch,
              installationId: instId,
              isActive: true,
            },
          });
          synced++;
        }
      } catch (err) {
        console.error(`[syncRepos] Failed to list repos for installation ${instId}:`, err);
      }
    }

    // Deactivate GitHub repos no longer in any installation
    const ghRemoved = await prisma.repository.updateMany({
      where: {
        organizationId: orgId,
        provider: "github",
        externalId: { notIn: allGhRepoIds },
        isActive: true,
      },
      data: { isActive: false },
    });
    removed += ghRemoved.count;
  }

  // Sync Bitbucket repos if integration exists
  const bbIntegration = await prisma.bitbucketIntegration.findUnique({
    where: { organizationId: orgId },
    select: { workspaceSlug: true },
  });

  if (bbIntegration) {
    try {
      const bbRepos = await listWorkspaceRepos(orgId, bbIntegration.workspaceSlug);
      const allBbRepoIds: string[] = [];

      for (const repo of bbRepos) {
        allBbRepoIds.push(repo.uuid);
        await prisma.repository.upsert({
          where: {
            provider_externalId: { provider: "bitbucket", externalId: repo.uuid },
          },
          create: {
            name: repo.name,
            fullName: repo.full_name,
            externalId: repo.uuid,
            defaultBranch: repo.mainbranch?.name ?? "main",
            provider: "bitbucket",
            organizationId: orgId,
          },
          update: {
            name: repo.name,
            fullName: repo.full_name,
            defaultBranch: repo.mainbranch?.name ?? "main",
            isActive: true,
          },
        });
        synced++;
      }

      // Deactivate Bitbucket repos no longer in workspace
      const bbRemoved = await prisma.repository.updateMany({
        where: {
          organizationId: orgId,
          provider: "bitbucket",
          externalId: { notIn: allBbRepoIds },
          isActive: true,
        },
        data: { isActive: false },
      });
      removed += bbRemoved.count;
    } catch (err) {
      console.error("[syncRepos] Failed to sync Bitbucket repos:", err);
    }
  }

  if (installationIds.size === 0 && !bbIntegration) {
    return { synced: 0, removed: 0, error: "No GitHub or Bitbucket integration linked." };
  }

  revalidatePath("/");
  return { synced, removed };
}

const INDEX_COOLDOWN_MS = 60_000; // 1 minute

export async function indexRepository(repoId: string): Promise<{ error?: string }> {
  const user = await getUser();

  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: {
      id: true,
      fullName: true,
      provider: true,
      defaultBranch: true,
      installationId: true,
      indexStatus: true,
      indexedAt: true,
      updatedAt: true,
      organizationId: true,
      organization: {
        select: {
          githubInstallationId: true,
          members: {
            where: { userId: user.id, deletedAt: null },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!repo || repo.organization.members.length === 0) return {};

  const installationId = repo.installationId ?? repo.organization.githubInstallationId;
  // GitHub repos need installationId; Bitbucket repos use OAuth tokens
  if (repo.provider === "github" && !installationId) return {};
  if (repo.provider === "bitbucket") {
    const bbIntegration = await prisma.bitbucketIntegration.findUnique({
      where: { organizationId: repo.organizationId },
      select: { id: true },
    });
    if (!bbIntegration) return {};
  }

  // If stuck in "indexing" for more than 10 minutes, reset to allow re-trigger
  const STALE_INDEX_MS = 10 * 60 * 1000;
  if (repo.indexStatus === "indexing") {
    const elapsed = Date.now() - repo.updatedAt.getTime();
    if (elapsed < STALE_INDEX_MS) {
      return { error: "Indexing is already in progress." };
    }
    // Stale — reset and continue
    await prisma.repository.update({
      where: { id: repoId },
      data: { indexStatus: "pending" },
    });
  }

  if (repo.indexedAt) {
    const elapsed = Date.now() - repo.indexedAt.getTime();
    if (elapsed < INDEX_COOLDOWN_MS) {
      const remaining = Math.ceil((INDEX_COOLDOWN_MS - elapsed) / 1000);
      return { error: `Please wait ${remaining}s before re-indexing.` };
    }
  }

  const channel = `presence-org-${repo.organizationId}`;

  const emitLog = (message: string, level: LogLevel = "info") => {
    const timestamp = Date.now();
    pubby.trigger(channel, "index-log", {
      repoId: repo.id,
      message,
      level,
      timestamp,
    });
    writeSyncLog({
      orgId: repo.organizationId,
      repoId: repo.id,
      message,
      level,
      timestamp,
    });
  };

  // Clear previous sync logs before starting new indexing
  await deleteSyncLogs(repo.organizationId, repo.id);

  await prisma.repository.update({
    where: { id: repoId },
    data: { indexStatus: "indexing" },
  });

  pubby.trigger(channel, "index-status", {
    repoId: repo.id,
    status: "indexing",
  });

  emitLog(`Starting indexing for ${repo.fullName}...`);

  const abortController = createAbortController(repoId);

  // Fire-and-forget: run indexing in background so the server action returns immediately.
  // Progress and completion are pushed to the client via Pubby real-time events.
  runIndexingInBackground(
    repo.id,
    repo.fullName,
    repo.defaultBranch,
    repo.organizationId,
    installationId ?? 0,
    channel,
    emitLog,
    abortController,
    repo.provider,
  );

  return {};
}

export async function cancelIndexing(repoId: string): Promise<{ error?: string }> {
  const user = await getUser();

  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    select: {
      id: true,
      indexStatus: true,
      organizationId: true,
      organization: {
        select: {
          members: {
            where: { userId: user.id, deletedAt: null },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!repo || repo.organization.members.length === 0) return {};

  if (repo.indexStatus !== "indexing") {
    return { error: "Repository is not currently indexing." };
  }

  const aborted = abortIndexing(repoId);

  if (!aborted) {
    // No in-memory controller found — the process is dead (e.g. server restart).
    // Directly reset the DB status so the user isn't stuck.
    try {
      console.warn(
        `[abort-indexing] No in-memory controller for repo ${repoId}, resetting DB status directly`,
      );

      await prisma.repository.update({
        where: { id: repoId },
        data: { indexStatus: "pending" },
      });

      revalidatePath("/repositories");
    } catch (error) {
      console.error(`[abort-indexing] Failed to reset status for repo ${repoId}:`, error);
      return { error: "Failed to cancel indexing. Please try again." };
    }

    pubby.trigger(`presence-org-${repo.organizationId}`, "index-status", {
      repoId,
      status: "cancelled",
    });
  }

  return {};
}

const VALID_THRESHOLDS = ["critical", "high", "medium", "none"] as const;

export async function updateCheckFailureThreshold(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const user = await getUser();
  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;

  if (!orgId) return { error: "No organization selected." };

  const member = await prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId: user.id,
      deletedAt: null,
    },
    select: { role: true },
  });

  if (!member || member.role !== "owner") {
    return { error: "Only organization owners can change review settings." };
  }

  const threshold = formData.get("threshold") as string;
  if (!VALID_THRESHOLDS.includes(threshold as (typeof VALID_THRESHOLDS)[number])) {
    return { error: "Invalid threshold value." };
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: { checkFailureThreshold: threshold },
  });

  revalidatePath("/settings/reviews");
  return { success: true };
}

export async function toggleReviewsPaused(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const user = await getUser();
  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;

  if (!orgId) return { error: "No organization selected." };

  const member = await prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId: user.id,
      deletedAt: null,
    },
    select: { role: true },
  });

  if (!member || member.role !== "owner") {
    return { error: "Only organization owners can pause reviews." };
  }

  const paused = formData.get("paused") === "true";

  await prisma.organization.update({
    where: { id: orgId },
    data: { reviewsPaused: paused },
  });

  revalidatePath("/settings/reviews");
  return { success: true };
}

export async function updateOrgDefaultReviewConfig(
  config: Record<string, unknown>,
): Promise<{ error?: string; success?: boolean }> {
  const user = await getUser();
  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;

  if (!orgId) return { error: "No organization selected." };

  const member = await prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId: user.id,
      deletedAt: null,
    },
    select: { role: true },
  });

  if (!member || member.role !== "owner") {
    return { error: "Only organization owners can change review defaults." };
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: { defaultReviewConfig: config as object },
  });

  revalidatePath("/settings/reviews");
  return { success: true };
}

export async function updateOrgBlockedAuthors(
  authors: string[],
): Promise<{ error?: string; success?: boolean }> {
  const user = await getUser();
  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;

  if (!orgId) return { error: "No organization selected." };

  const member = await prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId: user.id,
      deletedAt: null,
    },
    select: { role: true },
  });

  if (!member || member.role !== "owner") {
    return { error: "Only organization owners can change blocked authors." };
  }

  if (authors.length > 50) {
    return { error: "Maximum 50 blocked authors allowed." };
  }
  if (authors.some((a) => a.length > 100)) {
    return { error: "Author names must be 100 characters or less." };
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: { blockedAuthors: authors },
  });

  revalidatePath("/settings/reviews");
  return { success: true };
}

export async function acknowledgeIssue(issueId: string): Promise<{ error?: string }> {
  const user = await getUser();

  const issue = await prisma.reviewIssue.findUnique({
    where: { id: issueId },
    select: {
      pullRequest: {
        select: {
          repository: {
            select: {
              organization: {
                select: {
                  members: {
                    where: { userId: user.id, deletedAt: null },
                    select: { id: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!issue || issue.pullRequest.repository.organization.members.length === 0) {
    return { error: "Issue not found." };
  }

  await prisma.reviewIssue.update({
    where: { id: issueId },
    data: { acknowledgedAt: new Date() },
  });

  revalidatePath("/dashboard");
  revalidatePath("/issues");
  return {};
}

export async function feedbackIssue(
  issueId: string,
  feedback: "up" | "down" | null,
): Promise<{ error?: string }> {
  const user = await getUser();

  const issue = await prisma.reviewIssue.findUnique({
    where: { id: issueId },
    select: {
      feedback: true,
      pullRequest: {
        select: {
          repository: {
            select: {
              organization: {
                select: {
                  members: {
                    where: { userId: user.id, deletedAt: null },
                    select: { id: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!issue || issue.pullRequest.repository.organization.members.length === 0) {
    return { error: "Issue not found." };
  }

  // Toggle off if same feedback is clicked again
  const newFeedback = issue.feedback === feedback ? null : feedback;

  await prisma.reviewIssue.update({
    where: { id: issueId },
    data: {
      feedback: newFeedback,
      feedbackAt: newFeedback ? new Date() : null,
      feedbackBy: newFeedback ? user.id : null,
    },
  });

  // Embed feedback pattern for semantic matching in future reviews
  if (newFeedback) {
    try {
      const fullIssue = await prisma.reviewIssue.findUnique({
        where: { id: issueId },
        select: {
          id: true,
          title: true,
          description: true,
          severity: true,
          pullRequest: {
            select: {
              repositoryId: true,
              repository: { select: { organizationId: true } },
            },
          },
        },
      });
      if (fullIssue) {
        const { createEmbeddings } = await import("@/lib/embeddings");
        const { upsertFeedbackPattern, ensureFeedbackCollection } = await import("@/lib/qdrant");
        const { generateSparseVector } = await import("@/lib/sparse-vector");
        await ensureFeedbackCollection();
        const text = `${fullIssue.title} ${fullIssue.description}`;
        const [vector] = await createEmbeddings([text], {
          organizationId: fullIssue.pullRequest.repository.organizationId,
          operation: "embedding",
        });
        await upsertFeedbackPattern({
          id: fullIssue.id,
          vector,
          sparseVector: generateSparseVector(text),
          payload: {
            title: fullIssue.title,
            description: fullIssue.description,
            severity: fullIssue.severity,
            feedback: newFeedback,
            repoId: fullIssue.pullRequest.repositoryId,
            orgId: fullIssue.pullRequest.repository.organizationId,
          },
        });
      }
    } catch (err) {
      console.error("[feedbackIssue] Failed to embed feedback pattern:", err);
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/issues");
  return {};
}

export async function syncGithubReactions(
  orgId: string,
): Promise<{ synced: number; error?: string }> {
  const user = await getUser();

  const member = await prisma.organizationMember.findFirst({
    where: { userId: user.id, organizationId: orgId, deletedAt: null },
    select: { id: true },
  });
  if (!member) return { synced: 0, error: "Not a member." };

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { githubInstallationId: true },
  });
  if (!org?.githubInstallationId) return { synced: 0, error: "No GitHub installation." };

  // Find review issues with githubCommentId that haven't received feedback yet
  const issues = await prisma.reviewIssue.findMany({
    where: {
      githubCommentId: { not: null },
      feedback: null,
      pullRequest: { repository: { organizationId: orgId } },
    },
    select: {
      id: true,
      title: true,
      description: true,
      severity: true,
      githubCommentId: true,
      pullRequest: {
        select: {
          number: true,
          repositoryId: true,
          repository: { select: { fullName: true, organizationId: true } },
        },
      },
    },
    take: 50,
  });

  if (issues.length === 0) return { synced: 0 };

  const { getCommentReactions } = await import("@/lib/github");
  let synced = 0;

  for (const issue of issues) {
    const parts = issue.pullRequest.repository.fullName.split("/");
    if (parts.length !== 2) {
      console.error(`[syncReactions] Invalid repository fullName format: ${issue.pullRequest.repository.fullName}`);
      continue;
    }
    const [owner, repoName] = parts;

    const commentId = Number(issue.githubCommentId);
    if (isNaN(commentId)) {
      console.error(`[syncReactions] Invalid githubCommentId for issue ${issue.id}: ${issue.githubCommentId}`);
      continue;
    }

    try {
      const reactions = await getCommentReactions(
        org.githubInstallationId,
        owner,
        repoName,
        commentId,
      );

      if (reactions.thumbsUp > 0 || reactions.thumbsDown > 0) {
        const vote = reactions.thumbsUp >= reactions.thumbsDown ? "up" : "down";
        await prisma.reviewIssue.update({
          where: { id: issue.id },
          data: {
            feedback: vote,
            feedbackAt: new Date(),
            feedbackBy: "github-reaction",
          },
        });

        // Embed feedback pattern for semantic matching
        try {
          const { createEmbeddings } = await import("@/lib/embeddings");
          const { upsertFeedbackPattern, ensureFeedbackCollection } = await import("@/lib/qdrant");
          const { generateSparseVector } = await import("@/lib/sparse-vector");
          await ensureFeedbackCollection();
          const text = `${issue.title} ${issue.description}`;
          const [vector] = await createEmbeddings([text], {
            organizationId: issue.pullRequest.repository.organizationId,
            operation: "embedding",
          });
          await upsertFeedbackPattern({
            id: issue.id,
            vector,
            sparseVector: generateSparseVector(text),
            payload: {
              title: issue.title,
              description: issue.description,
              severity: issue.severity,
              feedback: vote,
              repoId: issue.pullRequest.repositoryId,
              orgId: issue.pullRequest.repository.organizationId,
            },
          });
        } catch (embedErr) {
          console.error(`[syncReactions] Failed to embed feedback for issue ${issue.id}:`, embedErr);
        }

        synced++;
      }
    } catch (err) {
      console.error(`[syncReactions] Failed for issue ${issue.id}:`, err);
    }
  }

  if (synced > 0) {
    revalidatePath("/dashboard");
    revalidatePath("/issues");
  }

  return { synced };
}
