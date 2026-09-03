import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

// ── fixtures (reset in beforeEach) ──
type ExistingRow = { externalId: string; dismissedAt: Date | null };
let orgRow: { githubInstallationId: number | null } | null = { githubInstallationId: 111 };
let repoInstallations: Array<{ installationId: number | null }> = [];
let existingRows: Record<string, ExistingRow[]> = { github: [], bitbucket: [], gitlab: [] };
let bitbucket: { workspaceSlug: string } | null = null;
let gitlab: { namespacePath: string; webhookSecret: string | null } | null = null;
let updateManyCount = 0;
const upserts: Array<Record<string, any>> = [];
const updateManys: Array<Record<string, any>> = [];

const prisma = {
  organization: { findUnique: mock(async () => orgRow) },
  repository: {
    findMany: mock(async (args: Record<string, any>) =>
      args.distinct ? repoInstallations : (existingRows[args.where.provider] ?? []),
    ),
    upsert: mock(async (args: Record<string, any>) => {
      upserts.push(args);
      return {
        id: `row_${args.where.provider_externalId_organizationId.externalId}`,
        fullName: args.create.fullName,
      };
    }),
    updateMany: mock(async (args: Record<string, any>) => {
      updateManys.push(args);
      return { count: updateManyCount };
    }),
    findUnique: mock(async (args: Record<string, any>) => {
      const ext = args.where.provider_externalId_organizationId.externalId;
      const row = existingRows.github.find((r) => r.externalId === ext);
      return row ? { dismissedAt: row.dismissedAt } : null;
    }),
  },
  bitbucketIntegration: { findUnique: mock(async () => bitbucket) },
  gitlabIntegration: { findUnique: mock(async () => gitlab) },
};
mock.module("@octopus/db", () => ({ prisma }));

class GithubRateLimitError extends Error {
  constructor(readonly status = 429, readonly retryAfterSeconds: number | null = null) {
    super(`GitHub rate limited (${status})`);
    this.name = "GithubRateLimitError";
  }
}
let ghRepos: Record<number, Array<Record<string, any>> | Error> = {};
const listInstallationRepos = mock(async (installationId: number) => {
  const v = ghRepos[installationId];
  if (v instanceof Error) throw v;
  return v ?? [];
});
// bun's mock.module is process-wide: spread the real module so other test files
// that import un-mocked exports keep working, override only what we stub.
const actualGithub = await import("@/lib/github");
mock.module("@/lib/github", () => ({ ...actualGithub, listInstallationRepos, GithubRateLimitError }));

let bbRepos: Array<Record<string, any>> = [];
const actualBitbucket = await import("@/lib/bitbucket");
mock.module("@/lib/bitbucket", () => ({ ...actualBitbucket, listWorkspaceRepos: mock(async () => bbRepos) }));

let glProjects: Array<Record<string, any>> = [];
const createProjectWebhook = mock(async () => 1);
const actualGitlab = await import("@/lib/gitlab");
mock.module("@/lib/gitlab", () => ({
  ...actualGitlab,
  listNamespaceProjects: mock(async () => glProjects),
  createProjectWebhook,
}));

const grantDeferredWelcomeCredit = mock(async () => {});
const actualOrgCreate = await import("@/lib/org-create");
mock.module("@/lib/org-create", () => ({ ...actualOrgCreate, grantDeferredWelcomeCredit }));

const trigger = mock(async () => {});
const actualPubby = await import("@/lib/pubby");
mock.module("@/lib/pubby", () => ({ ...actualPubby, pubby: { trigger }, PUBBY_ENABLED: true }));

const writeAuditLog = mock(async () => {});
const actualAudit = await import("@/lib/audit");
mock.module("@/lib/audit", () => ({ ...actualAudit, writeAuditLog }));

const { syncOrgRepos, applyRepositoryEvent } = await import("@/lib/repo-sync");

const gh = (id: number, name: string) => ({
  id,
  name,
  full_name: `acme/${name}`,
  private: true,
  default_branch: "main",
  html_url: `https://github.com/acme/${name}`,
});

describe("syncOrgRepos", () => {
  beforeEach(() => {
    orgRow = { githubInstallationId: 111 };
    repoInstallations = [];
    existingRows = { github: [], bitbucket: [], gitlab: [] };
    bitbucket = null;
    gitlab = null;
    ghRepos = {};
    bbRepos = [];
    glProjects = [];
    updateManyCount = 0;
    upserts.length = 0;
    updateManys.length = 0;
    listInstallationRepos.mockClear();
    createProjectWebhook.mockClear();
    grantDeferredWelcomeCredit.mockClear();
    trigger.mockClear();
    writeAuditLog.mockClear();
  });

  it("reports brand-new repositories as created and refreshed ones as synced only", async () => {
    existingRows.github = [{ externalId: "1", dismissedAt: null }];
    ghRepos[111] = [gh(1, "old"), gh(2, "new")];
    const r = await syncOrgRepos("org_1", { source: "scheduled" });
    expect(r.providers).toEqual(["github"]);
    expect(r.synced).toBe(2);
    expect(r.created).toBe(1);
    expect(r.createdRepos).toEqual([{ id: "row_2", fullName: "acme/new", provider: "github" }]);
    expect(upserts).toHaveLength(2);
    expect(upserts[1].create).toMatchObject({ externalId: "2", installationId: 111, isActive: true, organizationId: "org_1" });
    expect(grantDeferredWelcomeCredit).toHaveBeenCalledWith("org_1");
  });

  it("never resurrects a repository the user removed, and never deactivates dismissed rows", async () => {
    existingRows.github = [{ externalId: "9", dismissedAt: new Date("2026-08-01T00:00:00Z") }];
    ghRepos[111] = [gh(9, "removed-by-user"), gh(10, "fresh")];
    const r = await syncOrgRepos("org_1", { source: "manual" });
    expect(upserts.map((u) => u.where.provider_externalId_organizationId.externalId)).toEqual(["10"]);
    expect(r.created).toBe(1);
    const deactivation = updateManys.find((u) => u.where.provider === "github");
    expect(deactivation?.where).toMatchObject({
      organizationId: "org_1",
      isActive: true,
      dismissedAt: null,
      externalId: { notIn: ["9", "10"] },
      OR: [{ installationId: null }, { installationId: { in: [111] } }],
    });
    expect(deactivation?.data).toEqual({ isActive: false });
  });

  it("reports deactivated rows and never deactivates repos of installations it did not list", async () => {
    updateManyCount = 3;
    ghRepos[111] = [gh(1, "a")];
    const r = await syncOrgRepos("org_1", { source: "scheduled" });
    expect(r.removed).toBe(3);
    const deactivation = updateManys.find((u) => u.where.provider === "github");
    // Scheduled runs list only the org-level installation, so legacy rows on
    // other installations are excluded from the notIn sweep by this clause.
    expect(deactivation?.where.OR).toEqual([{ installationId: null }, { installationId: { in: [111] } }]);
  });

  it("keeps syncing other providers when a manual Sync hits a GitHub rate limit", async () => {
    ghRepos[111] = new GithubRateLimitError(429, 60);
    bitbucket = { workspaceSlug: "acme" };
    bbRepos = [{ uuid: "{u9}", name: "svc", full_name: "acme/svc", mainbranch: { name: "main" } }];
    const r = await syncOrgRepos("org_1", { source: "manual" });
    expect(r.providers).toEqual(["github", "bitbucket"]);
    expect(r.created).toBe(1);
    expect(updateManys.filter((u) => u.where.provider === "github")).toHaveLength(0);
  });

  it("uses only the org-level installation when scheduled, and widens to repo-level ids for manual sync", async () => {
    repoInstallations = [{ installationId: 222 }];
    ghRepos[111] = [];
    ghRepos[222] = [];
    await syncOrgRepos("org_1", { source: "scheduled" });
    expect(listInstallationRepos.mock.calls.map((c) => c[0])).toEqual([111]);
    listInstallationRepos.mockClear();
    await syncOrgRepos("org_1", { source: "manual" });
    expect(listInstallationRepos.mock.calls.map((c) => c[0]).sort()).toEqual([111, 222]);
  });

  it("propagates a GitHub rate limit so the sweep can stop", async () => {
    ghRepos[111] = new GithubRateLimitError(403, 60);
    await expect(syncOrgRepos("org_1", { source: "scheduled" })).rejects.toBeInstanceOf(GithubRateLimitError);
  });

  it("swallows an ordinary listing failure, keeps syncing other installations, and skips deactivation", async () => {
    repoInstallations = [{ installationId: 222 }];
    ghRepos[111] = new Error("boom");
    ghRepos[222] = [gh(5, "still-listed")];
    const r = await syncOrgRepos("org_1", { source: "manual" });
    expect(r.created).toBe(1);
    expect(updateManys.filter((u) => u.where.provider === "github")).toHaveLength(0);
  });

  it("creates a GitLab project hook only for newly discovered projects, and only with a secret", async () => {
    orgRow = { githubInstallationId: null };
    gitlab = { namespacePath: "acme", webhookSecret: "s3cret" };
    existingRows.gitlab = [{ externalId: "1", dismissedAt: null }];
    glProjects = [
      { id: 1, name: "known", path_with_namespace: "acme/known", default_branch: "main" },
      { id: 2, name: "brand-new", path_with_namespace: "acme/brand-new", default_branch: null },
    ];
    const r = await syncOrgRepos("org_1", { source: "scheduled" });
    expect(r.providers).toEqual(["gitlab"]);
    expect(r.created).toBe(1);
    expect(createProjectWebhook).toHaveBeenCalledTimes(1);
    expect(createProjectWebhook.mock.calls[0][1]).toBe("acme/brand-new");
    expect(upserts[1].create.defaultBranch).toBe("main");

    createProjectWebhook.mockClear();
    upserts.length = 0;
    existingRows.gitlab = [];
    gitlab = { namespacePath: "acme", webhookSecret: null };
    await syncOrgRepos("org_1", { source: "scheduled" });
    expect(createProjectWebhook).not.toHaveBeenCalled();
  });

  it("syncs Bitbucket repositories from the workspace", async () => {
    orgRow = { githubInstallationId: null };
    bitbucket = { workspaceSlug: "acme" };
    bbRepos = [{ uuid: "{u1}", name: "svc", full_name: "acme/svc", mainbranch: { name: "develop" } }];
    const r = await syncOrgRepos("org_1", { source: "scheduled" });
    expect(r.providers).toEqual(["bitbucket"]);
    expect(upserts[0].create).toMatchObject({ externalId: "{u1}", defaultBranch: "develop", provider: "bitbucket" });
  });

  it("reports no providers when nothing is linked and calls no provider", async () => {
    orgRow = { githubInstallationId: null };
    const r = await syncOrgRepos("org_1", { source: "manual" });
    expect(r).toEqual({ synced: 0, created: 0, removed: 0, createdRepos: [], providers: [] });
    expect(listInstallationRepos).not.toHaveBeenCalled();
    expect(grantDeferredWelcomeCredit).not.toHaveBeenCalled();
  });

  it("audits and notifies once when repositories were discovered, never when nothing is new", async () => {
    ghRepos[111] = [gh(1, "a"), gh(2, "b")];
    await syncOrgRepos("org_1", { source: "webhook" });
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({
      action: "repo.discovered",
      category: "repo",
      organizationId: "org_1",
      metadata: { source: "webhook", count: 2, repos: ["acme/a", "acme/b"] },
    });
    expect(trigger).toHaveBeenCalledWith("presence-org-org_1", "repos-discovered", { count: 2 });

    writeAuditLog.mockClear();
    trigger.mockClear();
    existingRows.github = [{ externalId: "1", dismissedAt: null }, { externalId: "2", dismissedAt: null }];
    await syncOrgRepos("org_1", { source: "webhook" });
    expect(writeAuditLog).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });
});

describe("applyRepositoryEvent (GitHub repository webhooks)", () => {
  beforeEach(() => {
    existingRows = { github: [], bitbucket: [], gitlab: [] };
    upserts.length = 0;
    updateManys.length = 0;
    updateManyCount = 1;
    grantDeferredWelcomeCredit.mockClear();
    trigger.mockClear();
    writeAuditLog.mockClear();
  });

  it("writes one row from the payload on created and announces it", async () => {
    const outcome = await applyRepositoryEvent("org_1", 111, "created", {
      id: 42,
      name: "fresh",
      full_name: "acme/fresh",
      default_branch: "trunk",
    });
    expect(outcome).toBe("created");
    expect(upserts).toHaveLength(1);
    expect(upserts[0].create).toMatchObject({ externalId: "42", defaultBranch: "trunk", installationId: 111, provider: "github" });
    expect(grantDeferredWelcomeCredit).toHaveBeenCalledWith("org_1");
    expect(writeAuditLog.mock.calls[0][0]).toMatchObject({ action: "repo.discovered", metadata: { source: "webhook", count: 1 } });
    expect(trigger).toHaveBeenCalledWith("presence-org-org_1", "repos-discovered", { count: 1 });
  });

  it("refreshes an existing row on rename without announcing, and never touches a dismissed one", async () => {
    existingRows.github = [{ externalId: "42", dismissedAt: null }, { externalId: "43", dismissedAt: new Date() }];
    expect(await applyRepositoryEvent("org_1", 111, "renamed", { id: 42, name: "renamed", full_name: "acme/renamed" })).toBe("updated");
    expect(upserts[0].update).toMatchObject({ fullName: "acme/renamed" });
    // No default_branch in the payload → the stored branch is left untouched.
    expect("defaultBranch" in upserts[0].update).toBe(false);
    expect(writeAuditLog).not.toHaveBeenCalled();
    expect(await applyRepositoryEvent("org_1", 111, "created", { id: 43, name: "back", full_name: "acme/back" })).toBe("dismissed");
    expect(upserts).toHaveLength(1);
  });

  it("deactivates (never deletes) on deleted and ignores unrelated actions", async () => {
    expect(await applyRepositoryEvent("org_1", 111, "deleted", { id: 7, name: "gone", full_name: "acme/gone" })).toBe("deactivated");
    expect(updateManys[0]).toMatchObject({
      where: { organizationId: "org_1", provider: "github", externalId: "7", isActive: true, dismissedAt: null },
      data: { isActive: false },
    });
    expect(await applyRepositoryEvent("org_1", 111, "archived", { id: 7, name: "gone", full_name: "acme/gone" })).toBe("ignored");
  });
});
