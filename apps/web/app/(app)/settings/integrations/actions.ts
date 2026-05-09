"use server";

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";

async function getAdminOrg() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) return null;

  const member = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id, organizationId: orgId, deletedAt: null },
    select: { role: true, organizationId: true },
  });

  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return null;
  }

  return { orgId: member.organizationId };
}

// ── Slack Actions ──

export async function disconnectSlack(): Promise<{ error?: string }> {
  const ctx = await getAdminOrg();
  if (!ctx) return { error: "Insufficient permissions." };

  const integration = await prisma.slackIntegration.findUnique({
    where: { organizationId: ctx.orgId },
    select: { id: true, accessToken: true },
  });

  if (!integration) return { error: "No Slack integration found." };

  // Revoke the token (best-effort)
  try {
    await fetch("https://slack.com/api/auth.revoke", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${integration.accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
  } catch (err) {
    console.error("[slack] Token revoke failed:", err);
  }

  // Cascade deletes event configs
  await prisma.slackIntegration.delete({
    where: { id: integration.id },
  });

  revalidatePath("/settings/integrations");
  return {};
}

export async function updateSlackChannel(
  formData: FormData,
): Promise<{ error?: string }> {
  const ctx = await getAdminOrg();
  if (!ctx) return { error: "Insufficient permissions." };

  const channelId = formData.get("channelId") as string;
  const channelName = formData.get("channelName") as string;

  if (!channelId) return { error: "Please select a channel." };

  await prisma.slackIntegration.update({
    where: { organizationId: ctx.orgId },
    data: { channelId, channelName },
  });

  revalidatePath("/settings/integrations");
  return {};
}

export async function toggleSlackEvent(
  eventType: string,
  enabled: boolean,
): Promise<{ error?: string }> {
  const ctx = await getAdminOrg();
  if (!ctx) return { error: "Insufficient permissions." };

  const integration = await prisma.slackIntegration.findUnique({
    where: { organizationId: ctx.orgId },
    select: { id: true },
  });

  if (!integration) return { error: "No Slack integration found." };

  await prisma.slackEventConfig.upsert({
    where: {
      slackIntegrationId_eventType: {
        slackIntegrationId: integration.id,
        eventType,
      },
    },
    create: {
      eventType,
      enabled,
      slackIntegrationId: integration.id,
    },
    update: { enabled },
  });

  revalidatePath("/settings/integrations");
  return {};
}

// ── GitLab Actions ──

function normalizeGitlabHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let host = raw.trim();
  if (!host) return null;
  if (!/^https?:\/\//i.test(host)) host = `https://${host}`;
  host = host.replace(/\/+$/, "");
  try {
    const url = new URL(host);
    if (url.pathname !== "/" && url.pathname !== "") return null;
    if (url.search || url.hash) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

const GITLAB_OAUTH_INIT_COOKIE = "gitlab_oauth_init";

export async function startGitlabOAuth(formData: FormData): Promise<void> {
  const ctx = await getAdminOrg();
  if (!ctx) {
    redirect("/settings/integrations?error=forbidden");
  }

  const namespacePath = String(formData.get("namespace") ?? "").trim();
  const hostInput = String(formData.get("host") ?? "");
  const customClientId = String(formData.get("clientId") ?? "").trim();
  const customClientSecret = String(formData.get("clientSecret") ?? "");

  if (!namespacePath) {
    redirect("/settings/integrations?error=missing_namespace");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(namespacePath) || namespacePath.length > 200) {
    redirect("/settings/integrations?error=invalid_namespace");
  }

  const gitlabHost = normalizeGitlabHost(hostInput) ?? "https://gitlab.com";
  const isCloud = gitlabHost === "https://gitlab.com";

  // Pick OAuth credentials: per-org for self-hosted, env defaults for gitlab.com
  let clientId: string;
  let clientSecretToStore: string | null = null;

  if (!isCloud || customClientId) {
    if (!customClientId || !customClientSecret) {
      redirect("/settings/integrations?error=missing_oauth_creds");
    }
    clientId = customClientId;
    clientSecretToStore = customClientSecret;
  } else {
    const envClientId = process.env.GITLAB_CLIENT_ID;
    if (!envClientId) {
      redirect("/settings/integrations?error=not_configured");
    }
    clientId = envClientId;
  }

  const redirectUri = process.env.GITLAB_REDIRECT_URI;
  if (!redirectUri) {
    redirect("/settings/integrations?error=not_configured");
  }

  // Encrypted, short-lived cookie carries the secret + nonce + context.
  // Never put the secret in the OAuth state URL.
  const { encryptJson } = await import("@/lib/crypto");
  const cryptoNode = await import("node:crypto");
  const nonce = cryptoNode.randomBytes(16).toString("hex");

  const cookiePayload = encryptJson({
    nonce,
    orgId: ctx.orgId,
    namespacePath,
    gitlabHost,
    clientId,
    clientSecret: clientSecretToStore,
    issuedAt: Date.now(),
  });

  const cookieStore = await cookies();
  cookieStore.set(GITLAB_OAUTH_INIT_COOKIE, cookiePayload, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });

  // State carries only the nonce — callback re-derives everything else from the cookie.
  const state = Buffer.from(JSON.stringify({ nonce })).toString("base64url");
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    state,
    scope: "api read_api read_user read_repository write_repository",
  });

  redirect(`${gitlabHost}/oauth/authorize?${params.toString()}`);
}

export async function disconnectGitlab(): Promise<{ error?: string }> {
  const ctx = await getAdminOrg();
  if (!ctx) return { error: "Insufficient permissions." };

  const integration = await prisma.gitlabIntegration.findUnique({
    where: { organizationId: ctx.orgId },
    select: { id: true },
  });

  if (!integration) return { error: "No GitLab integration found." };

  // We don't track per-project hook IDs, so webhooks are left as-is on
  // GitLab and will simply 401 against the rotated secret. That's safe and
  // matches the "minimal" Bitbucket-style disconnect flow.

  await prisma.gitlabIntegration.delete({
    where: { id: integration.id },
  });

  await prisma.repository.updateMany({
    where: {
      organizationId: ctx.orgId,
      provider: "gitlab",
    },
    data: { isActive: false },
  });

  revalidatePath("/settings/integrations");
  return {};
}

// ── Bitbucket Actions ──

export async function disconnectBitbucket(): Promise<{ error?: string }> {
  const ctx = await getAdminOrg();
  if (!ctx) return { error: "Insufficient permissions." };

  const integration = await prisma.bitbucketIntegration.findUnique({
    where: { organizationId: ctx.orgId },
    select: { id: true, workspaceSlug: true, webhookUuid: true },
  });

  if (!integration) return { error: "No Bitbucket integration found." };

  // Delete webhook (best-effort)
  if (integration.webhookUuid) {
    try {
      const { deleteWebhook } = await import("@/lib/bitbucket");
      await deleteWebhook(ctx.orgId, integration.workspaceSlug, integration.webhookUuid);
    } catch (err) {
      console.error("[bitbucket] Webhook cleanup failed:", err);
    }
  }

  // Delete integration
  await prisma.bitbucketIntegration.delete({
    where: { id: integration.id },
  });

  // Deactivate all Bitbucket repos for this org
  await prisma.repository.updateMany({
    where: {
      organizationId: ctx.orgId,
      provider: "bitbucket",
    },
    data: { isActive: false },
  });

  revalidatePath("/settings/integrations");
  return {};
}

// ── GitHub Actions ──

export async function disconnectGitHub(): Promise<{ error?: string }> {
  const ctx = await getAdminOrg();
  if (!ctx) return { error: "Insufficient permissions." };

  const org = await prisma.organization.findUnique({
    where: { id: ctx.orgId },
    select: { githubInstallationId: true },
  });

  if (!org?.githubInstallationId) return { error: "No GitHub integration found." };

  // Remove installation ID from org and all repo rows so that a subsequent
  // syncRepos cannot silently re-fetch and reactivate them via per-repo id.
  await prisma.$transaction([
    prisma.organization.update({
      where: { id: ctx.orgId },
      data: { githubInstallationId: null },
    }),
    prisma.repository.updateMany({
      where: {
        organizationId: ctx.orgId,
        provider: "github",
      },
      data: { isActive: false, installationId: null },
    }),
  ]);

  revalidatePath("/settings/integrations");
  return {};
}

// ── Collab Actions ──

const COLLAB_BASE_URL = "https://mcp-collab.weez.boo";

export async function connectCollab(
  formData: FormData,
): Promise<{ error?: string }> {
  const ctx = await getAdminOrg();
  if (!ctx) return { error: "Insufficient permissions." };

  const apiKey = (formData.get("apiKey") as string)?.trim();

  if (!apiKey) return { error: "Token is required." };

  // Fetch workspace info to validate token and get workspace ID
  let workspaceId: string | null = null;
  let workspaceName: string | null = null;

  try {
    const { listCollabWorkspaces } = await import("@/lib/collab");
    const workspaces = await listCollabWorkspaces(apiKey);
    if (workspaces.length > 0) {
      workspaceId = workspaces[0].id;
      workspaceName = workspaces[0].name;
    }
  } catch {
    return { error: "Invalid token or could not reach Collab server." };
  }

  await prisma.collabIntegration.upsert({
    where: { organizationId: ctx.orgId },
    create: {
      apiKey,
      baseUrl: COLLAB_BASE_URL,
      workspaceId,
      workspaceName,
      isActive: true,
      organizationId: ctx.orgId,
    },
    update: {
      apiKey,
      baseUrl: COLLAB_BASE_URL,
      workspaceId,
      workspaceName,
      isActive: true,
    },
  });

  revalidatePath("/settings/integrations");
  return {};
}

export async function disconnectCollab(): Promise<{ error?: string }> {
  const ctx = await getAdminOrg();
  if (!ctx) return { error: "Insufficient permissions." };

  const integration = await prisma.collabIntegration.findUnique({
    where: { organizationId: ctx.orgId },
    select: { id: true },
  });

  if (!integration) return { error: "No Collab integration found." };

  // Cascade deletes project mappings
  await prisma.collabIntegration.delete({
    where: { id: integration.id },
  });

  revalidatePath("/settings/integrations");
  return {};
}

export async function updateCollabMapping(
  formData: FormData,
): Promise<{ error?: string }> {
  const ctx = await getAdminOrg();
  if (!ctx) return { error: "Insufficient permissions." };

  const repositoryId = formData.get("repositoryId") as string;
  const collabProjectId = (formData.get("collabProjectId") as string)?.trim();
  const collabProjectName = (formData.get("collabProjectName") as string)?.trim();

  if (!repositoryId) return { error: "Repository is required." };
  if (!collabProjectId) return { error: "Collab Project ID is required." };

  const integration = await prisma.collabIntegration.findUnique({
    where: { organizationId: ctx.orgId },
    select: { id: true },
  });

  if (!integration) return { error: "No Collab integration found." };

  await prisma.collabProjectMapping.upsert({
    where: {
      collabIntegrationId_repositoryId: {
        collabIntegrationId: integration.id,
        repositoryId,
      },
    },
    create: {
      collabProjectId,
      collabProjectName: collabProjectName || collabProjectId,
      repositoryId,
      collabIntegrationId: integration.id,
    },
    update: {
      collabProjectId,
      collabProjectName: collabProjectName || collabProjectId,
    },
  });

  revalidatePath("/settings/integrations");
  return {};
}

export async function removeCollabMapping(
  repositoryId: string,
): Promise<{ error?: string }> {
  const ctx = await getAdminOrg();
  if (!ctx) return { error: "Insufficient permissions." };

  const integration = await prisma.collabIntegration.findUnique({
    where: { organizationId: ctx.orgId },
    select: { id: true },
  });

  if (!integration) return { error: "No Collab integration found." };

  await prisma.collabProjectMapping.deleteMany({
    where: {
      collabIntegrationId: integration.id,
      repositoryId,
    },
  });

  revalidatePath("/settings/integrations");
  return {};
}

// ── Linear Actions ──

export async function disconnectLinear(): Promise<{ error?: string }> {
  const ctx = await getAdminOrg();
  if (!ctx) return { error: "Insufficient permissions." };

  const integration = await prisma.linearIntegration.findUnique({
    where: { organizationId: ctx.orgId },
    select: { id: true, workspaceName: true },
  });

  if (!integration) return { error: "No Linear integration found." };

  // Cascade deletes team mappings
  await prisma.linearIntegration.delete({
    where: { id: integration.id },
  });

  const { writeAuditLog } = await import("@/lib/audit");
  await writeAuditLog({
    action: "integration.disconnected",
    category: "system",
    organizationId: ctx.orgId,
    targetType: "LinearIntegration",
    targetId: integration.id,
    metadata: { provider: "linear", workspaceName: integration.workspaceName },
  });

  revalidatePath("/settings/integrations");
  return {};
}

// ── Jira Actions ──

export async function disconnectJira(): Promise<{ error?: string }> {
  const ctx = await getAdminOrg();
  if (!ctx) return { error: "Insufficient permissions." };

  const integration = await prisma.jiraIntegration.findUnique({
    where: { organizationId: ctx.orgId },
    select: { id: true, siteName: true, cloudId: true, refreshToken: true },
  });

  if (!integration) return { error: "No Jira integration found." };

  // Best-effort revoke
  const clientId = process.env.JIRA_CLIENT_ID;
  const clientSecret = process.env.JIRA_CLIENT_SECRET;
  if (clientId && clientSecret) {
    try {
      const { decryptJiraToken } = await import("@/lib/jira");
      const revokeResponse = await fetch(
        "https://auth.atlassian.com/oauth/token/revoke",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            token: decryptJiraToken(integration.refreshToken),
            token_type_hint: "refresh_token",
          }),
        },
      );
      // Consume body so the connection can be released even though we ignore
      // the result (revoke is best-effort).
      await revokeResponse.text().catch(() => "");
      if (!revokeResponse.ok) {
        console.warn(
          "[jira] Token revoke returned non-2xx:",
          revokeResponse.status,
        );
      }
    } catch (err) {
      console.error("[jira] Token revoke failed:", err);
    }
  }

  // Cascade deletes project mappings
  await prisma.jiraIntegration.delete({
    where: { id: integration.id },
  });

  const { writeAuditLog } = await import("@/lib/audit");
  await writeAuditLog({
    action: "integration.disconnected",
    category: "system",
    organizationId: ctx.orgId,
    targetType: "JiraIntegration",
    targetId: integration.id,
    metadata: {
      provider: "jira",
      siteName: integration.siteName,
      cloudId: integration.cloudId,
    },
  });

  revalidatePath("/settings/integrations");
  return {};
}
