import "server-only";
import { prisma } from "@octopus/db";
import { listInstallationRepos, GithubRateLimitError } from "@/lib/github";
import { listWorkspaceRepos } from "@/lib/bitbucket";
import { listNamespaceProjects, createProjectWebhook } from "@/lib/gitlab";
import { grantDeferredWelcomeCredit } from "@/lib/org-create";
// Namespace import: read at call time so a partial module double elsewhere in
// the test process cannot break module load.
import * as realtime from "@/lib/pubby";
import { writeAuditLog } from "@/lib/audit";

/**
 * Org-scoped repository sync shared by the manual Sync button, the GitHub
 * webhook (installation / repository events) and the hourly
 * discover-repositories sweep. Lists every connected provider, upserts what it
 * finds, deactivates what disappeared, and reports which rows are new.
 *
 * Invariants:
 *  - a repository the user removed (`dismissedAt` set) is never resurrected;
 *  - repositories that vanished upstream are deactivated, never deleted, and
 *    only when every listing for that provider succeeded (a transient listing
 *    failure must not mass-deactivate an installation's repos);
 *  - no request-scoped side effects here (no revalidatePath): callers do that.
 */
export type RepoSyncSource = "manual" | "scheduled" | "webhook";
export type RepoSyncProvider = "github" | "bitbucket" | "gitlab";

export interface DiscoveredRepo {
  id: string;
  fullName: string;
  provider: RepoSyncProvider;
}

export interface RepoSyncResult {
  /** Rows created or refreshed. */
  synced: number;
  /** Rows that did not exist before this run. */
  created: number;
  /** Rows deactivated because the provider no longer lists them. */
  removed: number;
  createdRepos: DiscoveredRepo[];
  /** Providers that had an integration to sync; empty means nothing is linked. */
  providers: RepoSyncProvider[];
}

/** externalId → dismissedAt for the org's existing rows of one provider. */
async function loadExisting(organizationId: string, provider: RepoSyncProvider) {
  const rows = await prisma.repository.findMany({
    where: { organizationId, provider },
    select: { externalId: true, dismissedAt: true },
  });
  return new Map(rows.map((r) => [r.externalId, r.dismissedAt]));
}

async function upsertRepo(
  organizationId: string,
  provider: RepoSyncProvider,
  existing: Map<string, Date | null>,
  result: RepoSyncResult,
  repo: { externalId: string; name: string; fullName: string; defaultBranch?: string; installationId?: number },
): Promise<"created" | "updated" | "dismissed"> {
  if (existing.has(repo.externalId) && existing.get(repo.externalId) != null) return "dismissed";
  const isNew = !existing.has(repo.externalId);
  const row = await prisma.repository.upsert({
    where: {
      provider_externalId_organizationId: { provider, externalId: repo.externalId, organizationId },
    },
    create: {
      name: repo.name,
      fullName: repo.fullName,
      externalId: repo.externalId,
      defaultBranch: repo.defaultBranch ?? "main",
      provider,
      isActive: true,
      organizationId,
      ...(repo.installationId !== undefined ? { installationId: repo.installationId } : {}),
    },
    update: {
      name: repo.name,
      fullName: repo.fullName,
      // Only overwrite the stored default branch when the provider told us one;
      // a payload without it must not clobber a correct "master" with "main".
      ...(repo.defaultBranch !== undefined ? { defaultBranch: repo.defaultBranch } : {}),
      isActive: true,
      ...(repo.installationId !== undefined ? { installationId: repo.installationId } : {}),
    },
    select: { id: true, fullName: true },
  });
  result.synced++;
  if (isNew) {
    result.created++;
    result.createdRepos.push({ id: row.id, fullName: row.fullName, provider });
  }
  return isNew ? "created" : "updated";
}

async function deactivateMissing(
  organizationId: string,
  provider: RepoSyncProvider,
  presentIds: string[],
  /** GitHub only: restrict to rows belonging to the installations that were actually listed. */
  installationIds?: number[],
) {
  const res = await prisma.repository.updateMany({
    where: {
      organizationId,
      provider,
      externalId: { notIn: presentIds },
      isActive: true,
      dismissedAt: null,
      ...(installationIds
        ? { OR: [{ installationId: null }, { installationId: { in: installationIds } }] }
        : {}),
    },
    data: { isActive: false },
  });
  return res.count;
}

export async function syncOrgRepos(
  organizationId: string,
  opts: { source: RepoSyncSource },
): Promise<RepoSyncResult> {
  const result: RepoSyncResult = { synced: 0, created: 0, removed: 0, createdRepos: [], providers: [] };

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { githubInstallationId: true },
  });

  // ── GitHub ──
  // The org-level installation is the signed tenant authority (webhook-tenant.ts).
  // Repo-level installation ids are legacy data; only the manual button still
  // widens to them so existing users keep today's behaviour.
  const installationIds = new Set<number>();
  if (org?.githubInstallationId) installationIds.add(org.githubInstallationId);
  if (opts.source === "manual") {
    const repoInstallations = await prisma.repository.findMany({
      where: { organizationId, installationId: { not: null } },
      select: { installationId: true },
      distinct: ["installationId"],
    });
    for (const r of repoInstallations) if (r.installationId) installationIds.add(r.installationId);
  }

  if (installationIds.size > 0) {
    result.providers.push("github");
    const existing = await loadExisting(organizationId, "github");
    const present: string[] = [];
    let listingFailed = false;
    for (const installationId of installationIds) {
      try {
        const repos = await listInstallationRepos(installationId);
        for (const repo of repos) {
          const externalId = String(repo.id);
          present.push(externalId);
          await upsertRepo(organizationId, "github", existing, result, {
            externalId,
            name: repo.name,
            fullName: repo.full_name,
            defaultBranch: repo.default_branch,
            installationId,
          });
        }
      } catch (err) {
        // The sweep stops on a rate limit (cursor resumes next tick); a person
        // clicking Sync still gets the other providers synced.
        if (err instanceof GithubRateLimitError && opts.source !== "manual") throw err;
        listingFailed = true;
        console.error(`[repo-sync] Failed to list repos for installation ${installationId}:`, err);
      }
    }
    // Deactivate only rows the listing actually covered: rows tied to a legacy
    // installation this run did not list (non-manual sources) must stay put.
    if (!listingFailed) {
      result.removed += await deactivateMissing(organizationId, "github", present, [...installationIds]);
    }
  }

  // ── Bitbucket ──
  const bitbucket = await prisma.bitbucketIntegration.findUnique({
    where: { organizationId },
    select: { workspaceSlug: true },
  });
  if (bitbucket) {
    result.providers.push("bitbucket");
    try {
      const repos = await listWorkspaceRepos(organizationId, bitbucket.workspaceSlug);
      const existing = await loadExisting(organizationId, "bitbucket");
      const present: string[] = [];
      for (const repo of repos) {
        present.push(repo.uuid);
        await upsertRepo(organizationId, "bitbucket", existing, result, {
          externalId: repo.uuid,
          name: repo.name,
          fullName: repo.full_name,
          defaultBranch: repo.mainbranch?.name ?? "main",
        });
      }
      result.removed += await deactivateMissing(organizationId, "bitbucket", present);
    } catch (err) {
      console.error("[repo-sync] Failed to sync Bitbucket repos:", err);
    }
  }

  // ── GitLab ──
  // Group hooks are Premium-only, so every project carries its own hook (same
  // per-org secret). New projects therefore need a row AND a hook.
  const gitlab = await prisma.gitlabIntegration.findUnique({
    where: { organizationId },
    select: { namespacePath: true, webhookSecret: true },
  });
  if (gitlab) {
    result.providers.push("gitlab");
    try {
      const projects = await listNamespaceProjects(organizationId, gitlab.namespacePath);
      const existing = await loadExisting(organizationId, "gitlab");
      const present: string[] = [];
      const appUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
      for (const project of projects) {
        const externalId = String(project.id);
        present.push(externalId);
        const outcome = await upsertRepo(organizationId, "gitlab", existing, result, {
          externalId,
          name: project.name,
          fullName: project.path_with_namespace,
          defaultBranch: project.default_branch ?? "main",
        });
        if (outcome === "created" && gitlab.webhookSecret) {
          try {
            await createProjectWebhook(
              organizationId,
              project.path_with_namespace,
              `${appUrl}/api/gitlab/webhook`,
              gitlab.webhookSecret,
            );
          } catch (err) {
            console.warn(`[repo-sync] Hook creation failed for ${project.path_with_namespace}:`, err);
          }
        }
      }
      result.removed += await deactivateMissing(organizationId, "gitlab", present);
    } catch (err) {
      console.error("[repo-sync] Failed to sync GitLab projects:", err);
    }
  }

  // First repo connect releases a deferred welcome grant (no-op otherwise).
  if (result.synced > 0) await grantDeferredWelcomeCredit(organizationId);

  notifyDiscovered(organizationId, opts.source, result.createdRepos);

  return result;
}

/** One audit row + one realtime event per run that created repositories. */
function notifyDiscovered(organizationId: string, source: RepoSyncSource, createdRepos: DiscoveredRepo[]) {
  if (createdRepos.length === 0) return;
  void writeAuditLog({
    action: "repo.discovered",
    category: "repo",
    organizationId,
    targetType: "Organization",
    targetId: organizationId,
    metadata: {
      source,
      count: createdRepos.length,
      repos: createdRepos.slice(0, 50).map((r) => r.fullName),
    },
  }).catch(() => {});
  // Count only: the page re-fetches on this event, and an uncapped id list
  // would exceed realtime message limits on a large first sync.
  if (realtime.PUBBY_ENABLED) {
    realtime.pubby
      .trigger(`presence-org-${organizationId}`, "repos-discovered", { count: createdRepos.length })
      .catch((err: unknown) => console.warn("[repo-sync] realtime notify failed:", err));
  }
}

export type RepositoryEventOutcome = "created" | "updated" | "dismissed" | "deactivated" | "ignored";

/**
 * Fast path for GitHub `repository` webhooks (created / renamed / transferred /
 * deleted). The payload already carries id, name, full_name and default_branch,
 * so one row is written without listing the whole installation. Same
 * invariants as syncOrgRepos: dismissed rows are never resurrected, deletion
 * only deactivates, a newly created row is audited and announced.
 */
export async function applyRepositoryEvent(
  organizationId: string,
  installationId: number,
  action: string,
  repo: { id: number; name: string; full_name: string; default_branch?: string | null },
): Promise<RepositoryEventOutcome> {
  const externalId = String(repo.id);
  if (action === "deleted") {
    const res = await prisma.repository.updateMany({
      where: { organizationId, provider: "github", externalId, isActive: true, dismissedAt: null },
      data: { isActive: false },
    });
    return res.count > 0 ? "deactivated" : "ignored";
  }
  if (!["created", "renamed", "transferred"].includes(action)) return "ignored";

  const row = await prisma.repository.findUnique({
    where: { provider_externalId_organizationId: { provider: "github", externalId, organizationId } },
    select: { dismissedAt: true },
  });
  const existing = new Map<string, Date | null>(row ? [[externalId, row.dismissedAt]] : []);
  const result: RepoSyncResult = { synced: 0, created: 0, removed: 0, createdRepos: [], providers: ["github"] };
  const outcome = await upsertRepo(organizationId, "github", existing, result, {
    externalId,
    name: repo.name,
    fullName: repo.full_name,
    ...(repo.default_branch ? { defaultBranch: repo.default_branch } : {}),
    installationId,
  });
  if (outcome === "created") {
    await grantDeferredWelcomeCredit(organizationId);
    notifyDiscovered(organizationId, "webhook", result.createdRepos);
  }
  return outcome;
}
