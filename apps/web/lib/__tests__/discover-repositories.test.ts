import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

let orgs: Array<{ id: string }> = [];
let findManyArgs: Record<string, any> | null = null;
const findMany = mock(async (args: Record<string, any>) => {
  findManyArgs = args;
  return orgs;
});
const update = mock(async () => ({ count: 1 }));
mock.module("@octopus/db", () => ({ prisma: { organization: { findMany, updateMany: update } } }));

class GithubRateLimitError extends Error {
  constructor(readonly status = 429, readonly retryAfterSeconds: number | null = null) {
    super(`GitHub rate limited (${status})`);
    this.name = "GithubRateLimitError";
  }
}
const actualGithub = await import("@/lib/github");
mock.module("@/lib/github", () => ({ ...actualGithub, GithubRateLimitError }));

const empty = { synced: 0, created: 0, removed: 0, createdRepos: [], providers: [] };
let outcomes: Record<string, Record<string, unknown> | Error> = {};
const syncOrgRepos = mock(async (id: string) => {
  const o = outcomes[id];
  if (o instanceof Error) throw o;
  return o ?? empty;
});
mock.module("@/lib/repo-sync", () => ({ syncOrgRepos }));

const { discoverRepositories, DISCOVERY_BATCH_SIZE } = await import("@/lib/discover-repositories");

const NOW = new Date("2026-09-03T10:17:00.000Z");

describe("discoverRepositories", () => {
  beforeEach(() => {
    orgs = [];
    outcomes = {};
    findManyArgs = null;
    findMany.mockClear();
    update.mockClear();
    syncOrgRepos.mockClear();
  });

  it("syncs every due organization as a scheduled run and stamps the cursor", async () => {
    orgs = [{ id: "a" }, { id: "b" }];
    outcomes.a = { ...empty, created: 2 };
    outcomes.b = { ...empty, removed: 1 };
    const r = await discoverRepositories(NOW);
    expect(r).toEqual({ orgs: 2, created: 2, removed: 1, failed: 0, rateLimited: false });
    expect(syncOrgRepos.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["a", { source: "scheduled" }],
      ["b", { source: "scheduled" }],
    ]);
    expect(update.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: "a" }, data: { reposSyncedAt: NOW } },
      { where: { id: "b" }, data: { reposSyncedAt: NOW } },
    ]);
  });

  it("counts a failing organization, still stamps it, and keeps sweeping", async () => {
    orgs = [{ id: "bad" }, { id: "good" }];
    outcomes.bad = new Error("provider down");
    outcomes.good = { ...empty, created: 1 };
    const r = await discoverRepositories(NOW);
    expect(r).toEqual({ orgs: 2, created: 1, removed: 0, failed: 1, rateLimited: false });
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("stops the sweep on a GitHub rate limit after stamping the rate-limited org", async () => {
    orgs = [{ id: "limited" }, { id: "untouched" }];
    outcomes.limited = new GithubRateLimitError(429, 30);
    const r = await discoverRepositories(NOW);
    expect(r).toEqual({ orgs: 2, created: 0, removed: 0, failed: 1, rateLimited: true });
    expect(syncOrgRepos).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toEqual({ where: { id: "limited" }, data: { reposSyncedAt: NOW } });
  });

  it("asks for opted-in, live organizations with any integration, least-recently synced first", async () => {
    await discoverRepositories(NOW);
    expect(findManyArgs).toMatchObject({
      where: { deletedAt: null, bannedAt: null, autoDiscoverRepos: true },
      orderBy: { reposSyncedAt: { sort: "asc", nulls: "first" } },
      take: DISCOVERY_BATCH_SIZE,
    });
    expect(findManyArgs?.where.OR).toHaveLength(3);
  });
});
