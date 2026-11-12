import { expect, mock } from "bun:test";
mock.module("server-only", () => ({}));
const org = { id: "org-1", githubInstallationId: 42 };
let identity: unknown = { org, user: { id: "user-1" } };
let member: unknown = { id: "member-1" };
let claimCount = 0;
let starts = 0;
let indexRunnerArgs: unknown[] = [];
let syncs = 0;
const readArgs: unknown[] = [];
const claimArgs: unknown[] = [];
const activeRepo = { id: "repo-1", organizationId: "org-1", provider: "github", fullName: "acme/app", isActive: true, dismissedAt: null as Date | null, installationId: 42, indexStatus: "indexed", analysisStatus: "pending", indexedAt: new Date("2026-09-11T10:00:00Z"), analyzedAt: null, updatedAt: new Date("2026-09-11T10:00:00Z") };
let repositoryRows = [activeRepo];
type Lookup = { where: { organizationId: string; provider?: string; fullName?: { equals: string }; id?: string }; orderBy?: Array<Record<string, "asc" | "desc">> };
const db = {
  organizationMember: { findFirst: async (args: unknown) => { readArgs.push(args); return member; } },
  repository: {
    findFirst: async (args: Lookup) => {
      readArgs.push(args);
      const rows = repositoryRows.filter((row) => row.organizationId === args.where.organizationId
        && (!args.where.id || row.id === args.where.id)
        && (!args.where.provider || row.provider === args.where.provider)
        && (!args.where.fullName || row.fullName.toLowerCase() === args.where.fullName.equals.toLowerCase()));
      for (const order of [...(args.orderBy ?? [])].reverse()) {
        const [field, direction] = Object.entries(order)[0];
        rows.sort((a, b) => {
          const left = a[field as keyof typeof a]; const right = b[field as keyof typeof b];
          if (left === right) return 0;
          return (left! < right! ? -1 : 1) * (direction === "asc" ? 1 : -1);
        });
      }
      return rows[0] ?? null;
    },
    updateMany: async (args: unknown) => { claimArgs.push(args); return { count: claimCount }; },
  },
};
mock.module("@octopus/db", () => ({ prisma: db }));
mock.module("@/lib/api-auth", () => ({ authenticateApiToken: async () => identity }));
mock.module("@/lib/github-app-config", () => ({ getGithubAppConfig: async () => ({ slug: "octopus" }) }));
mock.module("@/lib/github", () => ({ getInstallationSettingsUrl: async () => "https://github.com/settings/installations/42", listInstallationRepos: async () => [{ id: 123, name: "app", full_name: "acme/app", default_branch: "main" }] }));
mock.module("@/lib/repo-sync", () => ({ applyRepositoryEvent: async () => { syncs++; } }));
mock.module("@/lib/analyzer", () => ({ analyzeRepository: async () => { starts++; return "analysis"; } }));
mock.module("@/lib/events/bus", () => ({ eventBus: { emit: () => {} } }));
mock.module("@/lib/indexing-runner", () => ({ runIndexingInBackground: (...args: unknown[]) => { starts++; indexRunnerArgs = args; } }));
const connect = await import("../../../app/api/cli/repos/connect/route");
const request = (body = { fullName: "acme/app" }) => new Request("https://octopus-review.ai/api/cli/repos/connect", { method: "POST", body: JSON.stringify(body) });
identity = null;
expect((await connect.POST(request())).status).toBe(401);
expect(readArgs).toHaveLength(0);
identity = Response.json({ error: "held" }, { status: 403 });
expect((await connect.POST(request())).status).toBe(403);
expect(readArgs).toHaveLength(0);
identity = { org, user: { id: "user-1" } };
member = null;
expect((await connect.POST(request())).status).toBe(403);
expect(readArgs).toHaveLength(1);
expect(readArgs[0]).toEqual({ where: { organizationId: "org-1", userId: "user-1", deletedAt: null }, select: { id: true } });
member = { id: "member-1" };
expect((await connect.POST(request({ fullName: "../other" }))).status).toBe(400);
const response = await connect.POST(request());
expect(response.status).toBe(200);
expect(await response.json()).toEqual({ state: "connected", repoId: "repo-1" });
expect(readArgs.at(-1)).toMatchObject({ where: { organizationId: "org-1", provider: "github", fullName: { equals: "acme/app", mode: "insensitive" } } });

// GitHub names can be reused: an inactive historical row must not hide the live one.
// Deliberately put the inactive row first, matching the production failure.
const historicalRepo = { ...activeRepo, id: "old-repo", isActive: false, updatedAt: new Date("2026-09-12T10:00:00Z") };
for (const historical of [historicalRepo, { ...historicalRepo, dismissedAt: new Date() }]) {
  repositoryRows = [historical, activeRepo];
  const connected = await connect.POST(request());
  const body = await connected.json();
  console.log(JSON.stringify({ scenario: historical.dismissedAt ? "dismissed history plus active" : "inactive history plus active", method: "POST", path: "/api/cli/repos/connect", request: { fullName: "acme/app" }, status: connected.status, body, syncs }));
  expect(connected.status).toBe(200);
  expect(body).toEqual({ state: "connected", repoId: "repo-1" });
}
repositoryRows = [{ ...historicalRepo, dismissedAt: new Date() }];
const dismissedResponse = await connect.POST(request());
const dismissedBody = await dismissedResponse.json();
console.log(JSON.stringify({ scenario: "dismissed only", status: dismissedResponse.status, body: dismissedBody, syncs }));
expect(dismissedResponse.status).toBe(200);
expect(dismissedBody).toMatchObject({ state: "repository_dismissed" });
expect(syncs).toBe(0);
// Newer active rows win; equal timestamps use the stable ID tie-breaker.
for (const rows of [
  [activeRepo, { ...activeRepo, id: "repo-new", updatedAt: new Date("2026-09-12T10:00:00Z") }],
  [{ ...activeRepo, id: "repo-z" }, activeRepo],
  [{ ...activeRepo, id: "foreign", organizationId: "org-other", updatedAt: new Date("2026-09-13T10:00:00Z") },
    { ...activeRepo, id: "other-provider", provider: "gitlab", updatedAt: new Date("2026-09-13T10:00:00Z") }, activeRepo],
]) {
  repositoryRows = rows;
  const result = await connect.POST(request({ fullName: "ACME/App" }));
  const body = await result.json();
  console.log(JSON.stringify({ scenario: "deterministic scoped lookup", candidateIds: rows.map(row => row.id), status: result.status, body }));
  expect(result.status).toBe(200);
  expect(body).toEqual({ state: "connected", repoId: rows.some(row => row.id === "repo-new") ? "repo-new" : "repo-1" });
}
expect(syncs).toBe(0);
repositoryRows = [{ ...activeRepo, installationId: 99 }];
const wrongInstallation = await connect.POST(request());
const wrongInstallationBody = await wrongInstallation.json();
console.log(JSON.stringify({ scenario: "wrong installation cannot connect", status: wrongInstallation.status, body: wrongInstallationBody }));
expect(wrongInstallation.status).toBe(503);
expect(wrongInstallationBody).not.toHaveProperty("repoId");
repositoryRows = [activeRepo];

// A lost compare-and-set must not start a second job.
const index = await import("../../../app/api/cli/repos/[id]/index/route");
const analyze = await import("../../../app/api/cli/repos/[id]/analyze/route");
const params = { params: Promise.resolve({ id: "repo-1" }) };
expect((await index.POST(request() as never, params)).status).toBe(409);
expect((await analyze.POST(request() as never, params)).status).toBe(409);
expect(starts).toBe(0);
expect(claimArgs[0]).toMatchObject({ where: { id: "repo-1", organizationId: "org-1", isActive: true, dismissedAt: null, indexStatus: "indexed", indexedAt: new Date("2026-09-11T10:00:00Z") } });
expect(claimArgs[1]).toMatchObject({ where: { id: "repo-1", organizationId: "org-1", isActive: true, dismissedAt: null, indexStatus: "indexed", analysisStatus: "pending", analyzedAt: null } });
claimCount = 1;
expect((await index.POST(request() as never, params)).status).toBe(200);
expect(indexRunnerArgs[10]).toBeUndefined();
console.log("Scoped connect route and concurrent job claims passed");
