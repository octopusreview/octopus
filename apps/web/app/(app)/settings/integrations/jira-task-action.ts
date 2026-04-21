"use server";

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import {
  createJiraIssue,
  getJiraProjects,
  JiraAuthError,
  type JiraIntegrationRecord,
  type JiraProject,
} from "@/lib/jira";
import { decryptJson } from "@/lib/crypto";
import { writeAuditLog } from "@/lib/audit";

const PENDING_COOKIE = "jira_oauth_pending";

type PendingPayload = {
  orgId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  sites: { cloudId: string; name: string; url: string }[];
};

// ── Helpers ──

async function getSessionAndOrg(): Promise<{ orgId: string } | { error: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) return { error: "No organization selected." };

  const member = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id, organizationId: orgId, deletedAt: null },
    select: { id: true },
  });
  if (!member) return { error: "Not a member of this organization." };

  return { orgId };
}

async function getAdminOrg(): Promise<{ orgId: string } | { error: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) return { error: "No organization selected." };

  const member = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id, organizationId: orgId, deletedAt: null },
    select: { role: true },
  });
  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return { error: "Insufficient permissions." };
  }
  return { orgId };
}

// ── Types ──

type InitResult =
  | { step: "mapped"; projectName: string; issueTypeName: string; repoFullName: string }
  | {
      step: "select_project";
      projects: JiraProject[];
      repoId: string;
      repoName: string;
    }
  | { error: string };

// ── Finalize site selection (multi-site OAuth) ──

export async function finalizeJiraSite(formData: FormData): Promise<void> {
  const ctx = await getAdminOrg();
  if ("error" in ctx) redirect("/settings/integrations?error=forbidden");

  const cookieStore = await cookies();
  const raw = cookieStore.get(PENDING_COOKIE)?.value;
  if (!raw) redirect("/settings/integrations?error=jira_session_expired");

  let payload: PendingPayload;
  try {
    payload = decryptJson<PendingPayload>(raw);
  } catch {
    redirect("/settings/integrations?error=jira_session_expired");
  }

  if (payload.orgId !== ctx.orgId) {
    redirect("/settings/integrations?error=forbidden");
  }

  const cloudId = formData.get("cloudId");
  if (typeof cloudId !== "string" || !cloudId) {
    redirect("/settings/integrations?error=invalid_site");
  }

  const site = payload.sites.find((s) => s.cloudId === cloudId);
  if (!site) redirect("/settings/integrations?error=invalid_site");

  const tokenExpiresAt = new Date(payload.expiresAt);
  const integration = await prisma.jiraIntegration.upsert({
    where: { organizationId: ctx.orgId },
    create: {
      organizationId: ctx.orgId,
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      tokenExpiresAt,
      cloudId: site.cloudId,
      siteUrl: site.url,
      siteName: site.name,
    },
    update: {
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      tokenExpiresAt,
      cloudId: site.cloudId,
      siteUrl: site.url,
      siteName: site.name,
    },
    select: { id: true },
  });

  await writeAuditLog({
    action: "integration.connected",
    category: "system",
    organizationId: ctx.orgId,
    targetType: "JiraIntegration",
    targetId: integration.id,
    metadata: { provider: "jira", siteName: site.name, cloudId: site.cloudId },
  });

  cookieStore.delete(PENDING_COOKIE);
  revalidatePath("/settings/integrations");
  redirect("/settings/integrations?success=jira");
}

// ── Issue creation flow ──

export async function initJiraIssueCreation(
  issueId: string,
): Promise<InitResult> {
  const ctx = await getSessionAndOrg();
  if ("error" in ctx) return { error: ctx.error };
  const { orgId } = ctx;

  const issue = await prisma.reviewIssue.findUnique({
    where: { id: issueId },
    include: {
      pullRequest: {
        include: { repository: true },
      },
    },
  });

  if (!issue) return { error: "Issue not found." };

  const repo = issue.pullRequest.repository;
  if (repo.organizationId !== orgId) {
    return { error: "Issue does not belong to this organization." };
  }

  const integration = await prisma.jiraIntegration.findUnique({
    where: { organizationId: orgId },
    include: {
      projectMappings: {
        where: { repositoryId: repo.id },
      },
    },
  });

  if (!integration) {
    return { error: "Jira integration is not configured." };
  }

  const mapping = integration.projectMappings[0];
  if (mapping) {
    return {
      step: "mapped",
      projectName: mapping.jiraProjectName,
      issueTypeName: mapping.jiraIssueTypeName,
      repoFullName: repo.fullName,
    };
  }

  // No mapping — fetch projects + issue types for selection
  try {
    const projects = await getJiraProjects(integration);
    return {
      step: "select_project",
      projects,
      repoId: repo.id,
      repoName: repo.fullName,
    };
  } catch (err) {
    if (err instanceof JiraAuthError) {
      return { error: err.message };
    }
    const message = err instanceof Error ? err.message : "Failed to fetch Jira projects";
    console.error("[jira-task] Failed to list projects:", err);
    return { error: message };
  }
}

export async function saveJiraProjectMapping(
  repoId: string,
  projectId: string,
  projectKey: string,
  projectName: string,
  issueTypeId: string,
  issueTypeName: string,
): Promise<{ success?: boolean; error?: string }> {
  const ctx = await getSessionAndOrg();
  if ("error" in ctx) return { error: ctx.error };
  const { orgId } = ctx;

  const integration = await prisma.jiraIntegration.findUnique({
    where: { organizationId: orgId },
    select: { id: true },
  });

  if (!integration) return { error: "No Jira integration found." };

  await prisma.jiraProjectMapping.upsert({
    where: {
      jiraIntegrationId_repositoryId: {
        jiraIntegrationId: integration.id,
        repositoryId: repoId,
      },
    },
    create: {
      jiraProjectId: projectId,
      jiraProjectKey: projectKey,
      jiraProjectName: projectName,
      jiraIssueTypeId: issueTypeId,
      jiraIssueTypeName: issueTypeName,
      repositoryId: repoId,
      jiraIntegrationId: integration.id,
    },
    update: {
      jiraProjectId: projectId,
      jiraProjectKey: projectKey,
      jiraProjectName: projectName,
      jiraIssueTypeId: issueTypeId,
      jiraIssueTypeName: issueTypeName,
    },
  });

  return { success: true };
}

export async function createJiraIssueFromReview(
  issueId: string,
  title: string,
  description: string,
): Promise<{ jiraIssueKey?: string; jiraIssueUrl?: string; error?: string }> {
  const ctx = await getSessionAndOrg();
  if ("error" in ctx) return { error: ctx.error };
  const { orgId } = ctx;

  const issue = await prisma.reviewIssue.findUnique({
    where: { id: issueId },
    include: {
      pullRequest: {
        include: { repository: true },
      },
    },
  });

  if (!issue) return { error: "Issue not found." };

  const repo = issue.pullRequest.repository;
  if (repo.organizationId !== orgId) {
    return { error: "Issue does not belong to this organization." };
  }

  const integration = await prisma.jiraIntegration.findUnique({
    where: { organizationId: orgId },
    include: {
      projectMappings: {
        where: { repositoryId: repo.id },
      },
    },
  });

  if (!integration) {
    return { error: "Jira integration is not configured." };
  }

  const mapping = integration.projectMappings[0];
  if (!mapping) {
    return { error: `No Jira project mapped for ${repo.fullName}.` };
  }

  const integrationRecord: JiraIntegrationRecord = {
    id: integration.id,
    accessToken: integration.accessToken,
    refreshToken: integration.refreshToken,
    tokenExpiresAt: integration.tokenExpiresAt,
    cloudId: integration.cloudId,
    siteUrl: integration.siteUrl,
  };

  try {
    const result = await createJiraIssue(
      integrationRecord,
      mapping.jiraProjectId,
      mapping.jiraIssueTypeId,
      title,
      description,
    );

    await prisma.reviewIssue.update({
      where: { id: issueId },
      data: {
        jiraIssueKey: result.key,
        jiraIssueUrl: result.url,
      },
    });

    await writeAuditLog({
      action: "integration.issue_created",
      category: "system",
      organizationId: orgId,
      targetType: "ReviewIssue",
      targetId: issueId,
      metadata: {
        provider: "jira",
        externalId: result.key,
        url: result.url,
        reviewIssueId: issueId,
      },
    });

    revalidatePath("/dashboard");
    revalidatePath("/timeline");
    return { jiraIssueKey: result.key, jiraIssueUrl: result.url };
  } catch (err) {
    if (err instanceof JiraAuthError) {
      return { error: err.message };
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[jira-task] Failed to create Jira issue:", err);
    return { error: message };
  }
}
