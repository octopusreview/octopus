"use server";

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { hasOrgPermission } from "@/lib/org-permissions";
import { pubby } from "@/lib/pubby";
import { writeSyncLog, deleteSyncLogs } from "@/lib/elasticsearch";
import { GithubRateLimitError } from "@/lib/github";
import { syncOrgRepos } from "@/lib/repo-sync";
import { WELCOME_DEFERRED_REASON } from "@/lib/org-create";
import type { LogLevel } from "@/lib/indexer";
import { createAbortController, abortIndexing } from "@/lib/indexing-abort";
import { runIndexingInBackground } from "@/lib/indexing-runner";
import { toBaseSlug, randomSlugSuffix } from "@/lib/slug";
import { canUserCreateOrg, hasEverOwnedOrg } from "@/lib/org-limits";
import { assessWelcomeCredit, logWelcomeOutcome } from "@/lib/welcome-credit";
import { MAX_OWNED_ORGS_PER_USER, WELCOME_FREE_CREDITS } from "@/lib/constants";
import { encryptString } from "@/lib/crypto";
import { validateProviderUrl } from "@/lib/providers/url-validation";
import { asThinkingEffort } from "@/lib/providers/thinking";
import { writeAuditLog } from "@/lib/audit";
import { canUseLiveTelemetry } from "@/lib/entitlements";
import { getClientIp } from "@/lib/request-ip";
import { clearPresence } from "@/lib/presence";

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

  const allowed = await canUserCreateOrg(user.id);
  if (!allowed) {
    return { error: `You can own at most ${MAX_OWNED_ORGS_PER_USER} organizations.` };
  }

  const name = (formData.get("name") as string)?.trim();

  if (!name || name.length < 2) {
    return { error: "Organization name must be at least 2 characters." };
  }
  if (name.length > 100) {
    return { error: "Organization name must be at most 100 characters." };
  }
  if (/[<>"{}]/.test(name)) {
    return { error: "Organization name contains invalid characters." };
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

  // Assess welcome-bonus risk before the tx (reads only); the tx confirms
  // first-org atomically.
  const welcome = await assessWelcomeCredit(user.id);

  // Re-check limit and create atomically to prevent TOCTOU race
  let org;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const ownedCount = await tx.organizationMember.count({
        where: { userId: user.id, role: "owner", deletedAt: null, organization: { deletedAt: null } },
      });
      if (ownedCount >= MAX_OWNED_ORGS_PER_USER) {
        throw new Error("ORG_LIMIT_REACHED");
      }

      // First org = bonus not yet granted (leak-proof stamp) AND never owned an
      // org (soft-delete-safe). `ownedCount` above is active-only (drives the cap).
      const firstOrg = welcome.eligible && !(await hasEverOwnedOrg(tx, user.id));

      // Consume the one-time bonus on the first org: stamp welcomeGrantedAt
      // exactly once (updateMany where null → only one tx wins, so concurrent
      // creates can't double-grant). A WITHHELD first org still consumes the
      // bonus, so it can't be retried after an org hard-delete. Credits are
      // added only when the claim wins AND the risk score clears.
      //
      // Users with no OAuth credential (magic-link signups have no `accounts`
      // row) get neither claim nor grant here — same gate as createOrgForUser:
      // their bonus is DEFERRED to the first repository connect
      // (grantDeferredWelcomeCredit), marked on the org via
      // WELCOME_DEFERRED_REASON.
      let grantBonus = false;
      let deferred = false;
      if (firstOrg) {
        const hasOauthAccount = (await tx.account.count({ where: { userId: user.id } })) > 0;
        if (hasOauthAccount) {
          const claim = await tx.user.updateMany({
            where: { id: user.id, welcomeGrantedAt: null },
            data: { welcomeGrantedAt: new Date() },
          });
          grantBonus = claim.count === 1 && welcome.grant;
        } else {
          deferred = true;
        }
      }

      const org = await tx.organization.create({
        data: {
          name: name.trim(),
          slug,
          members: {
            create: {
              userId: user.id,
              role: "owner",
            },
          },
          ...(firstOrg && {
            welcomeRiskScore: welcome.score,
            welcomeRiskReason: deferred ? WELCOME_DEFERRED_REASON : welcome.reason,
          }),
          ...(grantBonus && {
            freeCreditBalance: WELCOME_FREE_CREDITS,
            creditTransactions: {
              create: {
                amount: WELCOME_FREE_CREDITS,
                type: "free_credit",
                description: `Welcome bonus — $${WELCOME_FREE_CREDITS} free credits`,
                balanceAfter: WELCOME_FREE_CREDITS,
              },
            },
          }),
        },
      });
      return { org, firstOrg, granted: grantBonus, deferred };
    });
    org = created.org;
    // Surface a silently-withheld (or race-lost) welcome bonus in the logs.
    // A deferred grant isn't withheld — it's pending first repo connect.
    if (!created.deferred) {
      logWelcomeOutcome({ userId: user.id, orgId: org.id, firstOrg: created.firstOrg, granted: created.granted, decision: welcome });
    }
  } catch (err) {
    if (err instanceof Error && err.message === "ORG_LIMIT_REACHED") {
      return { error: `You can own at most ${MAX_OWNED_ORGS_PER_USER} organizations.` };
    }
    throw err;
  }

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

const DANGEROUS_NAME_CHARS = /[<>"`{}()\\/;]/;

export async function updateUserName(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const user = await getUser();

  const name = (formData.get("name") as string)?.trim();
  if (!name || name.length < 2) {
    return { error: "Name must be at least 2 characters." };
  }
  if (name.length > 100) {
    return { error: "Name must be at most 100 characters." };
  }
  if (DANGEROUS_NAME_CHARS.test(name)) {
    return { error: "Name contains invalid characters." };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { name },
  });

  revalidatePath("/");
  return { success: true };
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
    select: { role: true, scopes: true },
  });

  if (!hasOrgPermission(member, "settings:manage")) {
    return { error: "Only organization owners and admins can change the name." };
  }

  const name = (formData.get("name") as string)?.trim();
  if (!name || name.length < 2) {
    return { error: "Organization name must be at least 2 characters." };
  }
  if (name.length > 100) {
    return { error: "Organization name must be at most 100 characters." };
  }
  if (/[<>"{}]/.test(name)) {
    return { error: "Organization name contains invalid characters." };
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
    select: { role: true, scopes: true },
  });

  if (!hasOrgPermission(member, "settings:manage")) {
    return { error: "Only organization owners and admins can update API keys." };
  }

  const openaiApiKey = (formData.get("openaiApiKey") as string)?.trim() || null;
  const anthropicApiKey = (formData.get("anthropicApiKey") as string)?.trim() || null;
  const googleApiKey = (formData.get("googleApiKey") as string)?.trim() || null;
  const cohereApiKey = (formData.get("cohereApiKey") as string)?.trim() || null;
  const grokApiKey = (formData.get("grokApiKey") as string)?.trim() || null;
  const openrouterApiKey = (formData.get("openrouterApiKey") as string)?.trim() || null;
  const alibabaApiKey = (formData.get("alibabaApiKey") as string)?.trim() || null;

  if (openaiApiKey && !openaiApiKey.startsWith("sk-")) {
    return { error: "Invalid OpenAI API key format." };
  }

  if (anthropicApiKey && !anthropicApiKey.startsWith("sk-ant-")) {
    return { error: "Invalid Anthropic API key format." };
  }

  if (googleApiKey && !googleApiKey.startsWith("AIza")) {
    return { error: "Invalid Google AI API key format." };
  }

  if (grokApiKey && !grokApiKey.startsWith("xai-")) {
    return { error: "Invalid Grok (xAI) API key format." };
  }

  if (openrouterApiKey && !openrouterApiKey.startsWith("sk-or-")) {
    return { error: "Invalid OpenRouter API key format." };
  }

  if (alibabaApiKey && !alibabaApiKey.startsWith("sk-")) {
    return { error: "Invalid Alibaba Cloud Model Studio API key format." };
  }

  // Only update keys that have new values — empty fields keep the existing key.
  // Keys are encrypted at rest with the same helper used for OAuth tokens.
  const data: Record<string, string | null> = {};
  if (openaiApiKey) data.openaiApiKey = encryptString(openaiApiKey);
  if (anthropicApiKey) data.anthropicApiKey = encryptString(anthropicApiKey);
  if (googleApiKey) data.googleApiKey = encryptString(googleApiKey);
  if (cohereApiKey) data.cohereApiKey = encryptString(cohereApiKey);
  if (grokApiKey) data.grokApiKey = encryptString(grokApiKey);
  if (openrouterApiKey) data.openrouterApiKey = encryptString(openrouterApiKey);
  if (alibabaApiKey) data.alibabaApiKey = encryptString(alibabaApiKey);

  // Per-org provider config: gateway/base-URL overrides + gateway API keys.
  // These clear when submitted empty — a present-but-empty field sets the
  // column to null, an absent field (formData.get() === null) is left
  // unchanged. (The BYOK keys above share the older can't-clear-inline pattern:
  // they only clear via removeApiKey. Left as-is — out of scope for this fix.)
  // Base URLs are not secrets, but they become server-side fetch targets, so
  // they are SSRF-validated here before persisting; gateway API keys are
  // encrypted like the other BYOK keys.
  for (const field of ["ollamaBaseUrl", "acpBaseUrl", "opencodeBaseUrl"] as const) {
    const raw = formData.get(field);
    if (raw === null) continue;
    const trimmed = (raw as string).trim();
    if (!trimmed) {
      data[field] = null;
      continue;
    }
    try {
      data[field] = validateProviderUrl(trimmed);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Invalid provider URL." };
    }
  }
  for (const field of ["acpApiKey", "opencodeApiKey"] as const) {
    const raw = formData.get(field);
    if (raw === null) continue;
    const trimmed = (raw as string).trim();
    data[field] = trimmed ? encryptString(trimmed) : null;
  }

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

const VALID_KEY_FIELDS = ["openaiApiKey", "anthropicApiKey", "googleApiKey", "cohereApiKey", "grokApiKey", "openrouterApiKey", "alibabaApiKey"] as const;

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
    select: { role: true, scopes: true },
  });

  if (!hasOrgPermission(member, "settings:manage")) {
    return { error: "Only organization owners and admins can manage API keys." };
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
    select: { role: true, scopes: true },
  });

  if (!hasOrgPermission(member, "settings:manage")) {
    return { error: "Only organization owners and admins can change default models." };
  }

  const defaultModelId = (formData.get("defaultModelId") as string)?.trim() || null;
  const defaultEmbedModelId = (formData.get("defaultEmbedModelId") as string)?.trim() || null;
  // Empty = "Inherit platform default"; a non-empty value must be a valid effort
  // (reject rather than silently clear the override).
  const rawEffort = (formData.get("reviewEffort") as string)?.trim() || "";
  const reviewEffort = rawEffort ? asThinkingEffort(rawEffort) : null;
  if (rawEffort && reviewEffort === undefined) {
    return { error: "Invalid reasoning effort." };
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: { defaultModelId, defaultEmbedModelId, reviewEffort },
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
// The sync itself lives in lib/repo-sync.ts, shared with the webhook and the
// hourly discover-repositories sweep.
export async function syncRepos(): Promise<{ synced: number; removed: number; error?: string }> {
  await getUser();
  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;

  if (!orgId) return { synced: 0, removed: 0, error: "No organization selected." };

  try {
    const result = await syncOrgRepos(orgId, { source: "manual" });
    if (result.providers.length === 0) {
      return { synced: 0, removed: 0, error: "No GitHub, Bitbucket, or GitLab integration linked." };
    }
    revalidatePath("/");
    return { synced: result.synced, removed: result.removed };
  } catch (err) {
    if (err instanceof GithubRateLimitError) {
      return { synced: 0, removed: 0, error: "GitHub rate limit reached. Try again in a few minutes." };
    }
    throw err;
  }
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
    select: { role: true, scopes: true },
  });

  if (!hasOrgPermission(member, "reviews:configure")) {
    return { error: "Only organization owners and admins can change review settings." };
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
    select: { role: true, scopes: true },
  });

  if (!hasOrgPermission(member, "reviews:configure")) {
    return { error: "Only organization owners and admins can pause reviews." };
  }

  const paused = formData.get("paused") === "true";

  await prisma.organization.update({
    where: { id: orgId },
    data: { reviewsPaused: paused },
  });

  revalidatePath("/settings/reviews");
  return { success: true };
}

/**
 * Turn automatic repository discovery on/off for the org (hourly sweep +
 * GitHub repository events). Manual Sync keeps working either way.
 */
export async function toggleAutoDiscoverRepos(
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
    select: { role: true, scopes: true },
  });

  if (!hasOrgPermission(member, "reviews:configure")) {
    return { error: "Only organization owners and admins can change repository discovery." };
  }

  const enabled = formData.get("enabled") === "true";

  await prisma.organization.update({
    where: { id: orgId },
    data: { autoDiscoverRepos: enabled },
  });

  revalidatePath("/settings/reviews");
  return { success: true };
}

/**
 * Enable/disable live telemetry (real-time presence + activity) for the org.
 * Owner/admin only. Paid-only: a free org cannot enable it (entitlement is
 * re-checked server-side, never trusting the client). Audited under the
 * "admin" category since it controls member-activity monitoring.
 */
export async function toggleLiveTelemetry(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const user = await getUser();
  const reqHeaders = await headers();
  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;

  if (!orgId) return { error: "No organization selected." };

  const member = await prisma.organizationMember.findFirst({
    where: { organizationId: orgId, userId: user.id, deletedAt: null },
    select: { role: true, scopes: true },
  });

  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return { error: "Only organization owners and admins can change live telemetry." };
  }

  const enabled = formData.get("enabled") === "true";

  // Force-off for unpaid orgs: a free org may never enable telemetry, even if a
  // crafted form tries to. (Disabling is always allowed.)
  if (enabled && !(await canUseLiveTelemetry(orgId))) {
    return { error: "Live telemetry is a paid feature. Upgrade your plan to enable it." };
  }

  const orgBefore = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { liveTelemetryEnabled: true },
  });

  // No-op if unchanged — don't write a misleading audit entry.
  if (orgBefore && orgBefore.liveTelemetryEnabled === enabled) {
    return { success: true };
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: { liveTelemetryEnabled: enabled },
  });

  await writeAuditLog({
    action: enabled ? "telemetry.enabled" : "telemetry.disabled",
    category: "admin",
    actorId: user.id,
    actorEmail: user.email,
    targetType: "organization",
    targetId: orgId,
    organizationId: orgId,
    metadata: {
      liveTelemetryEnabled: { old: orgBefore?.liveTelemetryEnabled ?? false, new: enabled },
    },
    ipAddress: getClientIp(reqHeaders),
    userAgent: reqHeaders.get("user-agent") ?? null,
  });

  revalidatePath("/settings/telemetry");
  return { success: true };
}

/**
 * Per-member opt-out from live telemetry. When opted out, no presence/activity
 * is collected for this member in the current org. Any member may set their own
 * preference (no role gate — it's the member's own privacy choice).
 */
export async function toggleTelemetryOptOut(optedOut: boolean): Promise<{ error?: string }> {
  const user = await getUser();
  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) return { error: "No organization selected." };

  const member = await prisma.organizationMember.findFirst({
    where: { organizationId: orgId, userId: user.id, deletedAt: null },
    select: { id: true },
  });
  if (!member) return { error: "Not a member of this organization." };

  await prisma.organizationMember.update({
    where: { id: member.id },
    data: { telemetryOptedOut: optedOut },
  });

  // Opting out should take effect immediately — drop any live presence so the
  // member disappears from the roster at once (rather than after the TTL).
  if (optedOut) {
    await clearPresence(orgId, user.id);
  }

  revalidatePath("/settings/telemetry");
  return {};
}

/**
 * Org opt-in to letting Octopus (vendor) staff see member-level detail in the
 * cross-org console — SEPARATE from liveTelemetryEnabled (internal monitoring).
 * Owner-only: authorizing a third party to see named members is a higher-trust
 * consent than enabling internal monitoring. Audited under "admin".
 */
export async function toggleVendorMemberVisibility(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const user = await getUser();
  const reqHeaders = await headers();
  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) return { error: "No organization selected." };

  const member = await prisma.organizationMember.findFirst({
    where: { organizationId: orgId, userId: user.id, deletedAt: null },
    select: { role: true, scopes: true },
  });
  if (!member || member.role !== "owner") {
    return { error: "Only the organization owner can change vendor visibility." };
  }

  const allowed = formData.get("allowed") === "true";
  const before = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { allowVendorMemberVisibility: true },
  });
  if (before && before.allowVendorMemberVisibility === allowed) return { success: true };

  await prisma.organization.update({
    where: { id: orgId },
    data: { allowVendorMemberVisibility: allowed },
  });

  await writeAuditLog({
    action: allowed ? "telemetry.vendor_visibility_enabled" : "telemetry.vendor_visibility_disabled",
    category: "admin",
    actorId: user.id,
    actorEmail: user.email,
    targetType: "organization",
    targetId: orgId,
    organizationId: orgId,
    metadata: {
      allowVendorMemberVisibility: { old: before?.allowVendorMemberVisibility ?? false, new: allowed },
    },
    ipAddress: getClientIp(reqHeaders),
    userAgent: reqHeaders.get("user-agent") ?? null,
  });

  revalidatePath("/settings/telemetry");
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
    select: { role: true, scopes: true },
  });

  if (!hasOrgPermission(member, "reviews:configure")) {
    return { error: "Only organization owners and admins can change review defaults." };
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: { defaultReviewConfig: config as object },
  });

  revalidatePath("/settings/reviews");
  return { success: true };
}

export async function updateOrgReviewLanguage(
  language: string,
): Promise<{ error?: string; success?: boolean }> {
  const { isSupportedReviewLanguage } = await import("@/lib/review-language");
  const user = await getUser();
  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;

  if (!orgId) return { error: "No organization selected." };

  const member = await prisma.organizationMember.findFirst({
    where: { organizationId: orgId, userId: user.id, deletedAt: null },
    select: { role: true, scopes: true },
  });

  if (!hasOrgPermission(member, "reviews:configure")) {
    return { error: "Only organization owners and admins can change the review language." };
  }

  if (!isSupportedReviewLanguage(language)) {
    return { error: "Unsupported review language." };
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: { reviewLanguage: language },
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
    select: { role: true, scopes: true },
  });

  if (!hasOrgPermission(member, "reviews:configure")) {
    return { error: "Only organization owners and admins can change blocked authors." };
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
