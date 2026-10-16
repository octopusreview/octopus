import "./review-outcome-stub";
import { mock } from "bun:test";
import assert from "node:assert/strict";

const A = "a".repeat(40), B = "b".repeat(40);
const provider = process.argv[2] as "github" | "bitbucket" | "gitlab" | "forgejo";
const scenario = process.argv[3];
type Row = Record<string, unknown> & {
  id: string; headSha: string | null; reviewRequestVersion: number; status: string;
  updatedAt: Date; createdAt: Date; reviewBody: string | null;
};
const completed = (headSha = B, version = 2): Row => ({
  id: "pr", repositoryId: "repo", number: 1, title: "Title", author: "author", url: "https://example.test/pr/1",
  headSha, reviewRequestVersion: version, status: "completed", reviewBody: `Completed ${headSha}`,
  reviewCoverage: { complete: true }, triggerCommentId: 1, triggerCommentBody: "Review",
  updatedAt: new Date("2026-09-11T00:00:00Z"), createdAt: new Date("2026-09-11T00:00:00Z"),
});
let current: Row | null = completed();
let providerHead: string | null = B;
let headReads = 0, writes = 0, comments = 0, events = 0, enqueued = 0;
mock.module("@/lib/review-summary-comment", () => ({ publishReviewSummary: async () => ++comments }));
let duringHeadRead: (() => Promise<void>) | undefined;
let beforeWrite: (() => Promise<void>) | undefined;
let headFailure = false;
let queueFailure = false;
const org = { id: "org", githubInstallationId: 456 };
const repository = { id: "repo", organizationId: "org", organization: org, provider, fullName: "owner/repo", installationId: 123 as number | null, isActive: true };
function matches(where: Record<string, unknown>) {
  if (!current) return false;
  return Object.entries(where).every(([key, value]) => value instanceof Date
    ? current![key] instanceof Date && (current![key] as Date).getTime() === value.getTime()
    : current![key] === value);
}
function apply(data: Record<string, unknown>) {
  assert.ok(current);
  const increment = data.reviewRequestVersion as { increment: number } | undefined;
  const version = increment ? current.reviewRequestVersion + increment.increment : current.reviewRequestVersion;
  current = { ...current, ...structuredClone(data), reviewRequestVersion: version, updatedAt: new Date() };
}
mock.module("server-only", () => ({}));
const admissionDb = {
    organization: { findUnique: async () => ({ reviewsPaused: false, blockedAuthors: [] }) },
    systemConfig: { findUnique: async () => ({ blockedAuthors: [] }) },
    repository: { findFirst: async () => repository },
    pullRequest: {
      findUnique: async () => current ? { ...structuredClone(current), repository } : null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const callback = beforeWrite; beforeWrite = undefined; await callback?.();
        if (current) throw Object.assign(new Error("unique repository/PR"), { code: "P2002" });
        current = { ...completed(), ...structuredClone(data), reviewBody: null } as Row;
        writes++;
        return structuredClone(current);
      },
      updateManyAndReturn: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const callback = beforeWrite; beforeWrite = undefined; await callback?.();
        if (!matches(where)) return [];
        apply(data); writes++;
        return [structuredClone(current)];
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!matches(where)) return { count: 0 };
        apply(data);
        return { count: 1 };
      },
    },
};
mock.module("@octopus/db", () => ({ Prisma: { DbNull: null }, prisma: {
  ...admissionDb, $transaction: async (run: (tx: typeof admissionDb) => Promise<unknown>) => run(admissionDb),
} }));

for (const name of ["github", "bitbucket", "gitlab", "forgejo"]) {
  mock.module(`@/lib/${name}`, () => ({
    runWithForgejoRepository: async (_id: string, callback: () => Promise<unknown>) => callback(),
    getPullRequestDetails: async (...args: unknown[]) => {
      assert.equal(name, provider);
      if (name === "github") assert.equal(args[0], repository.installationId ?? org.githubInstallationId);
      headReads++;
      if (headFailure) throw new Error("Provider unavailable");
      const headSha = providerHead;
      const callback = duringHeadRead; duringHeadRead = undefined; await callback?.();
      return { number: 1, title: "Title", author: "author", url: "https://example.test/pr/1", headSha };
    },
    createPullRequestComment: async () => ++comments,
  }));
}
mock.module("@/lib/pubby", () => ({ pubby: { trigger: async () => { events++; } } }));
mock.module("@/lib/events", () => ({ eventBus: { emit: () => undefined } }));
mock.module("@/lib/queue", () => ({ enqueue: async () => { if (queueFailure) throw new Error("Queue unavailable"); enqueued++; } }));
mock.module("@/lib/api-auth", () => ({ authenticateApiToken: async () => ({ org }) }));
const { startReviewFlow } = await import("../../webhook-shared");
const params = {
  provider, installationId: 123, organizationId: "org", orgId: "org", repoFullName: "owner/repo", repoId: "repo",
  prNumber: 1, prTitle: "Title", prUrl: "https://example.test/pr/1", prAuthor: "author", headSha: A as string | null,
  triggerCommentId: 1, triggerCommentBody: "Review",
};
const preserve = async (headSha: string | null, reason = "stale_head") => {
  const before = structuredClone(current);
  const counts = [writes, comments, events, enqueued];
  const result = await startReviewFlow({ ...params, headSha });
  assert.equal(result.started, false);
  if (!result.started) assert.equal(result.reason, reason);
  assert.deepEqual(current, before);
  assert.deepEqual([writes, comments, events, enqueued], counts);
};
const admitBAndComplete = async () => {
  providerHead = B;
  assert.equal((await startReviewFlow({ ...params, headSha: B })).started, true);
  current = { ...current!, status: "completed", reviewBody: "New B report", updatedAt: new Date() };
};
if (scenario === "enqueue_retry") {
  queueFailure = true;
  await assert.rejects(startReviewFlow({ ...params, headSha: B }), /Queue unavailable/);
  assert.equal(current!.reviewRequestVersion, 3);
  queueFailure = false;
  if (provider === "forgejo") {
    assert.equal(current!.status, "failed");
    assert.equal((await startReviewFlow({ ...params, headSha: B })).started, true);
    assert.equal(current!.reviewRequestVersion, 4);
    assert.equal(enqueued, 1);
  } else {
    assert.equal(current!.status, "pending");
    assert.equal(current!.errorMessage, null);
    await preserve(B, "already_in_progress");
    assert.equal(current!.reviewRequestVersion, 3);
    assert.equal(enqueued, 0);
  }
} else if (scenario === "delayed") {
  await preserve(A);
  assert.equal(headReads, 1);
} else if (scenario === "fetch_race" || scenario === "write_race" || scenario === "create_race") {
  current = scenario === "create_race" ? null : completed(A, 1);
  providerHead = A;
  if (scenario === "fetch_race") duringHeadRead = admitBAndComplete;
  else beforeWrite = admitBAndComplete;
  const result = await startReviewFlow(params);
  assert.equal(result.started, false);
  if (!result.started) assert.equal(result.reason, "stale_head");
  assert.equal(current!.headSha, B);
  assert.equal(current!.reviewBody, "New B report");
  assert.equal(current!.reviewRequestVersion, scenario === "create_race" ? 1 : 2);
  assert.equal(headReads, 3, "contested admission must refresh provider state");
  assert.equal(writes, 1);
  assert.equal(comments, 1);
  assert.equal(enqueued, 1);
} else if (scenario === "same_head") {
  const result = await startReviewFlow({ ...params, headSha: B });
  assert.equal(result.started, true);
  assert.equal(current!.reviewRequestVersion, 3);
  assert.equal(current!.headSha, B);
  assert.equal(current!.reviewBody, null);
  assert.equal(current!.reviewCoverage, null);
  assert.equal(enqueued, 1);
  await preserve(B, "already_in_progress");
} else if (scenario === "same_head_race") {
  duringHeadRead = async () => {
    assert.equal((await startReviewFlow({ ...params, headSha: B })).started, true);
  };
  const result = await startReviewFlow({ ...params, headSha: B });
  assert.equal(result.started, false);
  if (!result.started) assert.equal(result.reason, "already_in_progress");
  assert.equal(current!.reviewRequestVersion, 3);
  assert.equal(writes, 1);
  assert.equal(enqueued, 1);
  assert.equal(headReads, 3);
} else if (scenario === "contended") {
  const contend = async () => {
    current!.updatedAt = new Date(current!.updatedAt.getTime() + 1);
    beforeWrite = contend;
  };
  beforeWrite = contend;
  const result = await startReviewFlow({ ...params, headSha: B });
  assert.equal(result.started, false);
  if (!result.started) assert.equal(result.reason, "request_contended");
  assert.equal(current!.reviewBody, `Completed ${B}`);
  assert.equal(current!.reviewRequestVersion, 2);
  assert.equal(headReads, 3);
  assert.equal(writes + comments + events + enqueued, 0);
} else if (scenario === "stuck_retry") {
  current = { ...completed(), status: "reviewing", updatedAt: new Date(0) };
  assert.equal((await startReviewFlow({ ...params, headSha: B })).started, true);
  assert.equal(current.reviewRequestVersion, 3);
  assert.equal(current.status, "pending");
  assert.equal(writes, 1);
} else if (scenario === "initial") {
  current = null;
  assert.equal((await startReviewFlow({ ...params, headSha: B })).started, true);
  assert.equal((current as Row | null)?.headSha, B);
  assert.equal((current as Row | null)?.reviewRequestVersion, 1);
  assert.equal(writes, 1);
  assert.equal(enqueued, 1);
} else if (scenario === "legacy") {
  current = { ...completed(), headSha: null, reviewRequestVersion: 0 };
  assert.equal((await startReviewFlow({ ...params, headSha: null })).started, true);
  assert.equal(current.headSha, B);
  assert.equal(current.reviewRequestVersion, 1);
  assert.equal(enqueued, 1);
} else if (scenario === "unknown_request") {
  assert.equal((await startReviewFlow({ ...params, headSha: "" })).started, true);
  assert.equal(current!.headSha, B);
  assert.equal(current!.reviewRequestVersion, 3);
} else if (scenario === "missing_head") {
  providerHead = null;
  await preserve(null, "head_unavailable");
} else if (scenario === "provider_failure") {
  headFailure = true;
  const before = structuredClone(current);
  await assert.rejects(startReviewFlow(params), /Provider unavailable/);
  assert.deepEqual(current, before);
  assert.equal(writes + comments + events + enqueued, 0);
} else if (scenario === "stale_stuck") {
  current = { ...completed(), status: "reviewing", updatedAt: new Date(0) };
  await preserve(A);
} else if (scenario === "force_push") {
  providerHead = A;
  assert.equal((await startReviewFlow(params)).started, true);
  assert.equal(current!.headSha, A, "provider-authoritative force pushes remain legitimate");
  assert.equal(current!.reviewRequestVersion, 3);
} else if (scenario === "retry_org_installation") {
  assert.equal(provider, "github");
  repository.installationId = null;
  const { POST } = await import("../../../app/api/admin/reviews/[id]/retry/route");
  const { NextRequest } = await import("next/server");
  process.env.ADMIN_API_SECRET = "fixture-admin-secret";
  const response = await POST(new NextRequest("https://example.test/api/admin/reviews/pr/retry", {
    method: "POST", headers: { authorization: "Bearer fixture-admin-secret" },
  }), { params: Promise.resolve({ id: "pr" }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).pullRequestId, "pr");
  assert.equal(headReads, 1);
  assert.equal(current!.reviewRequestVersion, 3);
  assert.equal(enqueued, 1);
} else if (scenario === "retry" || scenario === "retry_race") {
  const { POST } = await import("../../../app/api/admin/reviews/[id]/retry/route");
  const { NextRequest } = await import("next/server");
  process.env.ADMIN_API_SECRET = "fixture-admin-secret";
  current = completed(A, 1);
  const before = structuredClone(current);
  if (scenario === "retry_race") {
    providerHead = A;
    duringHeadRead = admitBAndComplete;
  }
  const response = await POST(new NextRequest("https://example.test/api/admin/reviews/pr/retry", {
    method: "POST", headers: { authorization: "Bearer fixture-admin-secret" },
  }), { params: Promise.resolve({ id: "pr" }) });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, "stale_head");
  if (scenario === "retry_race") {
    assert.equal(current!.headSha, B);
    assert.equal(current!.reviewBody, "New B report");
    assert.equal(writes, 1);
    assert.equal(enqueued, 1);
  } else {
    assert.deepEqual(current, before);
    assert.equal(writes + enqueued, 0);
  }
} else if (scenario === "cli_existing" || scenario === "cli_race" || scenario === "cli_org_installation") {
  if (scenario === "cli_org_installation") {
    assert.equal(provider, "github");
    repository.installationId = null;
  }
  const { POST } = await import("../../../app/api/cli/repos/[id]/review/route");
  const { NextRequest } = await import("next/server");
  if (scenario === "cli_race") {
    current = completed(A, 1);
    providerHead = A;
    duringHeadRead = admitBAndComplete;
  }
  const response = await POST(new NextRequest("https://example.test/api/cli/repos/repo/review", {
    method: "POST", body: JSON.stringify({ prNumber: 1 }), headers: { "content-type": "application/json" },
  }), { params: Promise.resolve({ id: "repo" }) });
  if (scenario === "cli_race") {
    assert.equal(response.status, 409);
    assert.equal((await response.json()).reason, "stale_head");
    assert.equal(current!.reviewBody, "New B report");
    assert.equal(current!.reviewRequestVersion, 2);
    assert.equal(writes, 1);
  } else {
    assert.equal(response.status, 200);
    assert.equal((await response.json()).pullRequestId, "pr");
    assert.equal(current!.reviewRequestVersion, 3);
    assert.equal(headReads, 2);
  }
  assert.equal(current!.headSha, B);
  assert.equal(enqueued, 1);
} else {
  throw new Error(`Unknown scenario ${scenario}`);
}
console.log(JSON.stringify({ scenario, provider, passed: true }));
