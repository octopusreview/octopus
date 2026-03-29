"use server";

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { getLinearTeams, createLinearIssue, LinearAuthError } from "@/lib/linear";

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

// ── Types ──

type InitResult =
  | { step: "mapped"; teamName: string; repoFullName: string }
  | { step: "select_team"; teams: { id: string; name: string; key: string }[]; repoId: string; repoName: string }
  | { error: string };

// ── Actions ──

export async function initLinearIssueCreation(issueId: string): Promise<InitResult> {
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

  const integration = await prisma.linearIntegration.findUnique({
    where: { organizationId: orgId },
    include: {
      teamMappings: {
        where: { repositoryId: repo.id },
      },
    },
  });

  if (!integration) {
    return { error: "Linear integration is not configured." };
  }

  const mapping = integration.teamMappings[0];
  if (mapping) {
    return {
      step: "mapped",
      teamName: mapping.linearTeamName,
      repoFullName: repo.fullName,
    };
  }

  // No mapping — fetch teams for selection
  try {
    const teams = await getLinearTeams(integration.accessToken);
    return {
      step: "select_team",
      teams,
      repoId: repo.id,
      repoName: repo.fullName,
    };
  } catch (err) {
    if (err instanceof LinearAuthError) {
      return { error: err.message };
    }
    const message = err instanceof Error ? err.message : "Failed to fetch Linear teams";
    console.error("[linear-task] Failed to list teams:", err);
    return { error: message };
  }
}

export async function saveLinearTeamMapping(
  repoId: string,
  teamId: string,
  teamName: string,
  teamKey: string,
): Promise<{ success?: boolean; error?: string }> {
  const ctx = await getSessionAndOrg();
  if ("error" in ctx) return { error: ctx.error };
  const { orgId } = ctx;

  const integration = await prisma.linearIntegration.findUnique({
    where: { organizationId: orgId },
    select: { id: true },
  });

  if (!integration) return { error: "No Linear integration found." };

  await prisma.linearTeamMapping.upsert({
    where: {
      linearIntegrationId_repositoryId: {
        linearIntegrationId: integration.id,
        repositoryId: repoId,
      },
    },
    create: {
      linearTeamId: teamId,
      linearTeamName: teamName,
      linearTeamKey: teamKey,
      repositoryId: repoId,
      linearIntegrationId: integration.id,
    },
    update: {
      linearTeamId: teamId,
      linearTeamName: teamName,
      linearTeamKey: teamKey,
    },
  });

  return { success: true };
}

export async function createLinearIssueFromReview(
  issueId: string,
  title: string,
  description: string,
): Promise<{ linearIssueId?: string; linearIssueUrl?: string; error?: string }> {
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

  const integration = await prisma.linearIntegration.findUnique({
    where: { organizationId: orgId },
    include: {
      teamMappings: {
        where: { repositoryId: repo.id },
      },
    },
  });

  if (!integration) {
    return { error: "Linear integration is not configured." };
  }

  const mapping = integration.teamMappings[0];
  if (!mapping) {
    return { error: `No Linear team mapped for ${repo.fullName}.` };
  }

  try {
    const result = await createLinearIssue(
      integration.accessToken,
      mapping.linearTeamId,
      title,
      description,
    );

    // Update the ReviewIssue with Linear issue info
    await prisma.reviewIssue.update({
      where: { id: issueId },
      data: {
        linearIssueId: result.id,
        linearIssueUrl: result.url,
      },
    });

    revalidatePath("/dashboard");
    revalidatePath("/timeline");
    return { linearIssueId: result.id, linearIssueUrl: result.url };
  } catch (err) {
    if (err instanceof LinearAuthError) {
      return { error: err.message };
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[linear-task] Failed to create Linear issue:", err);
    return { error: message };
  }
}
