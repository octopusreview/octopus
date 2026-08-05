import { mock } from "bun:test";

type RepositoryRecord = {
  id: string;
  organizationId: string;
  autoReview: boolean;
  fullName: string;
  isActive: boolean;
  dismissedAt: Date | null;
};

const currentRepository: RepositoryRecord = {
  id: "repo_current",
  organizationId: "org_current",
  autoReview: true,
  fullName: "current/project",
  isActive: true,
  dismissedAt: null,
};
const staleRepository: RepositoryRecord = {
  id: "repo_stale",
  organizationId: "org_stale",
  autoReview: true,
  fullName: "stale/project",
  isActive: true,
  dismissedAt: null,
};

const reviewCalls: Array<Record<string, unknown>> = [];
const mutationCalls: Array<{ kind: string; args: Record<string, unknown> }> = [];
let integrationAmbiguous = false;
let repositoryMode: "resolved" | "missing" | "inactive" = "resolved";

mock.module("server-only", () => ({}));
mock.module("next/server", () => ({
  NextRequest: Request,
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  },
}));
mock.module("@/lib/gitlab", () => ({
  getPullRequestDetails: () =>
    Promise.resolve({
      title: "Resolved MR",
      url: "https://gitlab.test/current/project/-/merge_requests/18",
      author: "contributor",
      headSha: "def456",
    }),
}));
mock.module("@/lib/webhook-shared", () => ({
  startReviewFlow: (input: Record<string, unknown>) => {
    reviewCalls.push(input);
    return Promise.resolve();
  },
}));
mock.module("@octopus/db", () => ({
  prisma: {
    repository: {
      // Legacy route control: a repository-first lookup selects the wrong tenant.
      findFirst: () => Promise.resolve(staleRepository),
      findUnique: () => {
        if (repositoryMode === "missing") return Promise.resolve(null);
        if (repositoryMode === "inactive") {
          return Promise.resolve({
            ...currentRepository,
            isActive: false,
            dismissedAt: new Date("2026-08-05T00:00:00Z"),
          });
        }
        return Promise.resolve(currentRepository);
      },
      update: (args: Record<string, unknown>) => {
        mutationCalls.push({ kind: "repository.update", args });
        return Promise.resolve({});
      },
      updateMany: (args: Record<string, unknown>) => {
        mutationCalls.push({ kind: "repository.updateMany", args });
        return Promise.resolve({ count: 1 });
      },
    },
    gitlabIntegration: {
      // Legacy route control: the stale repository selects the wrong secret.
      findUnique: () => Promise.resolve({ webhookSecret: "stale-secret" }),
      findMany: ({ where }: { where: { webhookSecret: string } }) => {
        if (where.webhookSecret !== "current-secret") return Promise.resolve([]);
        if (integrationAmbiguous) {
          return Promise.resolve([
            { organizationId: "org_current", webhookSecret: "current-secret" },
            { organizationId: "org_other", webhookSecret: "current-secret" },
          ]);
        }
        return Promise.resolve([
          { organizationId: "org_current", webhookSecret: "current-secret" },
        ]);
      },
    },
    pullRequest: {
      updateMany: (args: Record<string, unknown>) => {
        mutationCalls.push({ kind: "pullRequest.updateMany", args });
        return Promise.resolve({ count: 1 });
      },
    },
  },
}));

const { POST } = await import("@/app/api/gitlab/webhook/route");

function mergeRequestPayload(overrides: Record<string, unknown> = {}) {
  return {
    project: { id: 9001, path_with_namespace: "current/project" },
    object_attributes: {
      action: "open",
      state: "opened",
      iid: 17,
      title: "Tenant boundary regression",
      url: "https://gitlab.test/current/project/-/merge_requests/17",
      last_commit: { id: "abc123" },
      ...overrides,
    },
    user: { username: "contributor" },
  };
}

function webhookRequest(options: {
  token?: string;
  event?: string;
  payload?: Record<string, unknown>;
} = {}) {
  return new Request("https://app.test/api/gitlab/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-gitlab-event": options.event ?? "Merge Request Hook",
      "x-gitlab-token": options.token ?? "current-secret",
    },
    body: JSON.stringify(options.payload ?? mergeRequestPayload()),
  }) as never;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};
console.log = () => undefined;
console.warn = () => undefined;
console.error = () => undefined;

try {
  const accepted = await POST(webhookRequest());
  assert(accepted.status === 200, "current integration secret was rejected");
  assert(reviewCalls.length === 1, "valid webhook did not start one review");
  assert(reviewCalls[0]?.orgId === "org_current", "wrong GitLab tenant selected");
  assert(reviewCalls[0]?.repoId === "repo_current", "wrong GitLab repository selected");
  assert(mutationCalls.length === 0, "open MR fell through into merge mutations");

  let unauthenticatedBodyRead = false;
  const guardedInvalidRequest = {
    headers: new Headers({
      "x-gitlab-event": "Merge Request Hook",
      "x-gitlab-token": "invalid-secret",
    }),
    text: () => {
      unauthenticatedBodyRead = true;
      throw new Error("unauthenticated body was read");
    },
  } as never;
  const invalid = await POST(guardedInvalidRequest);
  assert(invalid.status === 401, "invalid GitLab token was not rejected");
  assert(!unauthenticatedBodyRead, "invalid token was checked after reading the body");
  assert(reviewCalls.length === 1, "invalid token started a review");

  integrationAmbiguous = true;
  const ambiguousResponse = await POST(webhookRequest());
  assert(ambiguousResponse.status === 401, "ambiguous GitLab token was not rejected");
  assert(reviewCalls.length === 1, "ambiguous token started a review");
  integrationAmbiguous = false;

  repositoryMode = "missing";
  const missingResponse = await POST(webhookRequest());
  repositoryMode = "inactive";
  const inactiveResponse = await POST(webhookRequest());
  assert(missingResponse.status === 200, "unowned project was not acknowledged");
  assert(inactiveResponse.status === 200, "inactive project was not acknowledged");
  assert(reviewCalls.length === 1, "unowned or inactive project started a review");
  assert(mutationCalls.length === 0, "unowned or inactive project mutated state");
  repositoryMode = "resolved";

  const mergedResponse = await POST(
    webhookRequest({
      payload: mergeRequestPayload({ action: "merge", state: "merged" }),
    }),
  );
  assert(mergedResponse.status === 200, "merged MR response failed");
  assert(
    mutationCalls.some(
      (call) =>
        call.kind === "pullRequest.updateMany" &&
        (call.args.where as { repositoryId?: string })?.repositoryId ===
          "repo_current",
    ),
    "merged MR did not mutate only the resolved repository",
  );
  assert(
    mutationCalls.some((call) => {
      if (call.kind !== "repository.updateMany") return false;
      const where = call.args.where as { id?: string; indexStatus?: string };
      return where?.id === "repo_current" && where?.indexStatus === "indexed";
    }),
    "merged MR stale marking was not scoped to an indexed resolved repository",
  );

  const noteResponse = await POST(
    webhookRequest({
      event: "Note Hook",
      payload: {
        project: { id: 9001 },
        object_attributes: {
          noteable_type: "MergeRequest",
          note: "@octopus review this",
          id: 88,
        },
        merge_request: {
          iid: 18,
          title: "Mention review",
          url: "https://gitlab.test/current/project/-/merge_requests/18",
          last_commit: { id: "def456" },
        },
        user: { username: "contributor" },
      },
    }),
  );
  assert(noteResponse.status === 200, "note webhook response failed");
  assert(reviewCalls.length === 2, "note mention did not start one review");
  assert(reviewCalls[1]?.orgId === "org_current", "note used the wrong tenant");
  assert(reviewCalls[1]?.repoId === "repo_current", "note used the wrong repository");

  originalConsole.log(JSON.stringify({
    tenantSecretSelectedRepository: true,
    tokenCheckedBeforeBody: true,
    invalidTokenRejected: true,
    ambiguousTokenRejected: true,
    unownedAndInactiveDropped: true,
    mergedAndNoteScoped: true,
  }));
} catch (error) {
  originalConsole.error(error);
  process.exitCode = 1;
} finally {
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
}
