import crypto from "node:crypto";
import { mock } from "bun:test";

const WEBHOOK_SECRET = "github-webhook-enforcement-test-secret";

type AfterCallback = () => void | Promise<void>;
type DeliveryUpsertArgs = {
  where: {
    provider_deliveryId: { provider: string; deliveryId: string };
  };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

const afterCallbacks: AfterCallback[] = [];
const deliveryWrites: DeliveryUpsertArgs[] = [];
const reviewCalls: Array<Record<string, unknown>> = [];
const mutationCalls: Array<{ kind: string; args: Record<string, unknown> }> = [];
let failNextLedgerWrite = false;
let installationBindingCleared = false;
let legacyRepositoryLookups = 0;

const webhookDeliveryStore = {
  upsert: (args: DeliveryUpsertArgs) => {
    if (failNextLedgerWrite) {
      failNextLedgerWrite = false;
      return Promise.reject(new Error("ledger unavailable"));
    }
    deliveryWrites.push(args);
    return Promise.resolve({
      attemptCount: 1,
      payloadSha256: String(args.create.payloadSha256),
    });
  },
  update: () => Promise.resolve({ payloadHashCollisionCount: 1 }),
};

mock.module("server-only", () => ({}));
mock.module("next/server", () => ({
  after: (callback: AfterCallback) => afterCallbacks.push(callback),
  NextRequest: Request,
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  },
}));
mock.module("next/cache", () => ({ revalidatePath: () => undefined }));
mock.module("@/lib/github-app-config", () => ({
  getGithubAppConfig: () =>
    Promise.resolve({ webhookSecret: WEBHOOK_SECRET, appId: "123", slug: "octopus" }),
}));
mock.module("@/lib/github", () => ({
  listInstallationRepos: () => Promise.resolve([]),
  getRepositoryDetails: () => Promise.resolve(null),
  addCommentReaction: () => Promise.resolve(),
  getPullRequestDetails: () => Promise.resolve(null),
  createCheckRun: () => Promise.resolve(1),
  updateCheckRun: () => Promise.resolve(),
}));
mock.module("@/lib/webhook-shared", () => ({
  startReviewFlow: (input: Record<string, unknown>) => {
    reviewCalls.push(input);
    return Promise.resolve();
  },
}));
mock.module("@octopus/db", () => ({
  prisma: {
    organization: {
      findUnique: (args: {
        where: { githubInstallationId?: number; id?: string };
      }) => {
        if (args.where.githubInstallationId === 222) {
          if (installationBindingCleared) return Promise.resolve(null);
          return Promise.resolve({ id: "org_b" });
        }
        if (args.where.id === "org_b") {
          return Promise.resolve({ blockedAuthors: [] });
        }
        return Promise.resolve(null);
      },
      updateMany: () => {
        installationBindingCleared = true;
        return Promise.resolve({ count: 1 });
      },
    },
    repository: {
      findFirst: () => {
        legacyRepositoryLookups += 1;
        return Promise.resolve({
          id: "repo_a",
          organizationId: "org_a",
          autoReview: true,
          installationId: 222,
        });
      },
      findUnique: (args: {
        where: {
          id?: string;
          provider_externalId_organizationId?: {
            provider: string;
            externalId: string;
            organizationId: string;
          };
        };
      }) => {
        if (args.where.provider_externalId_organizationId) {
          return Promise.resolve({ id: "repo_b", organizationId: "org_b" });
        }
        if (args.where.id === "repo_b") {
          return Promise.resolve({
            id: "repo_b",
            organizationId: "org_b",
            autoReview: true,
            installationId: 222,
            fullName: "shared/repository",
            defaultBranch: "main",
            indexStatus: "pending",
          });
        }
        return Promise.resolve(null);
      },
      findMany: () => Promise.resolve([]),
      count: () => Promise.resolve(2),
      update: (args: Record<string, unknown>) => {
        mutationCalls.push({ kind: "repository.update", args });
        return Promise.resolve({});
      },
      upsert: () => Promise.resolve({}),
    },
    pullRequest: {
      updateMany: (args: Record<string, unknown>) => {
        mutationCalls.push({ kind: "pullRequest.updateMany", args });
        return Promise.resolve({ count: 1 });
      },
    },
    systemConfig: {
      findUnique: () => Promise.resolve({ blockedAuthors: [] }),
    },
    webhookDelivery: webhookDeliveryStore,
    $transaction: <T>(
      callback: (transaction: {
        webhookDelivery: typeof webhookDeliveryStore;
      }) => Promise<T>,
    ) => callback({ webhookDelivery: webhookDeliveryStore }),
  },
}));

const { POST } = await import("@/app/api/github/webhook/route");

function pullRequestBody() {
  return JSON.stringify({
    action: "opened",
    installation: { id: 222 },
    repository: { id: 9001, full_name: "shared/repository" },
    pull_request: {
      number: 17,
      title: "Tenant collision regression",
      html_url: "https://github.test/shared/repository/pull/17",
      user: { login: "contributor" },
      head: { sha: "abc123" },
      draft: false,
    },
  });
}

function mergedPullRequestBody() {
  return JSON.stringify({
    action: "closed",
    installation: { id: 222 },
    repository: { id: 9001, full_name: "shared/repository" },
    pull_request: {
      number: 18,
      merged: true,
    },
  });
}

function issueCommentBody() {
  return JSON.stringify({
    action: "created",
    installation: { id: 222 },
    repository: { id: 9001, full_name: "shared/repository" },
    issue: {
      number: 19,
      title: "Mention review",
      html_url: "https://github.test/shared/repository/pull/19",
      user: { login: "contributor" },
      pull_request: {},
    },
    comment: {
      id: 88,
      body: "@octopus review this",
      user: { type: "User", login: "contributor" },
    },
  });
}

function webhookRequest(
  body: string,
  options: {
    deliveryId?: string;
    eventType?: string;
    validSignature?: boolean;
  } = {},
) {
  const signature = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(body)
    .digest("hex");
  return new Request("https://app.test/api/github/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": options.eventType ?? "pull_request",
      "x-github-delivery": options.deliveryId ?? "delivery-123",
      "x-hub-signature-256": options.validSignature === false
        ? "sha256=invalid"
        : `sha256=${signature}`,
    },
    body,
  }) as never;
}

async function runAfterCallbacks() {
  const callbacks = afterCallbacks.splice(0);
  await Promise.all(callbacks.map((callback) => callback()));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
};
console.log = () => undefined;
console.info = () => undefined;
console.warn = () => undefined;

try {
  const invalidResponse = await POST(
    webhookRequest(pullRequestBody(), { validSignature: false }),
  );
  assert(invalidResponse.status === 401, "invalid signature was not rejected");
  assert(afterCallbacks.length === 0, "invalid signature scheduled observation");
  assert(deliveryWrites.length === 0, "invalid signature wrote to the ledger");
  assert(reviewCalls.length === 0, "invalid signature started a review");

  const collisionResponse = await POST(webhookRequest(pullRequestBody()));
  assert(collisionResponse.status === 200, "valid collision response failed");
  assert(reviewCalls[0]?.orgId === "org_b", "signed installation did not select tenant");
  assert(reviewCalls[0]?.repoId === "repo_b", "compound tenant/repository lookup was not enforced");
  await runAfterCallbacks();
  const collision = deliveryWrites.at(-1)?.create;
  assert(collision?.resolvedOrganizationId === "org_b", "trusted tenant was not recorded");
  assert(
    collision?.legacyOrganizationId === null,
    "legacy repository unexpectedly remained routing input",
  );
  assert(
    collision?.comparisonStatus === "not_applicable",
    "post-enforcement telemetry unexpectedly compared legacy routing",
  );

  const reviewsBeforeUnmapped = reviewCalls.length;
  const unmappedBody = JSON.stringify({
    ...JSON.parse(pullRequestBody()),
    installation: { id: 999 },
  });
  const unmappedResponse = await POST(
    webhookRequest(unmappedBody, { deliveryId: "delivery-unmapped" }),
  );
  await runAfterCallbacks();
  assert(unmappedResponse.status === 200, "unmapped installation response failed");
  assert(
    reviewCalls.length === reviewsBeforeUnmapped,
    "unmapped installation was not dropped",
  );

  const mergedResponse = await POST(
    webhookRequest(mergedPullRequestBody(), {
      deliveryId: "delivery-merged",
    }),
  );
  await runAfterCallbacks();
  assert(mergedResponse.status === 200, "merged PR response failed");
  assert(
    mutationCalls.some(
      (call) =>
        call.kind === "pullRequest.updateMany" &&
        (call.args.where as { repositoryId?: string })?.repositoryId === "repo_b",
    ),
    "merged PR did not mutate only the installation-owned repository",
  );

  const reviewsBeforeMention = reviewCalls.length;
  const mentionResponse = await POST(
    webhookRequest(issueCommentBody(), {
      deliveryId: "delivery-mention",
      eventType: "issue_comment",
    }),
  );
  await runAfterCallbacks();
  assert(mentionResponse.status === 200, "issue comment response failed");
  assert(
    reviewCalls.length === reviewsBeforeMention + 1 &&
      reviewCalls.at(-1)?.orgId === "org_b" &&
      reviewCalls.at(-1)?.repoId === "repo_b",
    "issue comment did not route through the installation-owned repository",
  );
  assert(legacyRepositoryLookups === 0, "legacy repository-only lookup was used");

  failNextLedgerWrite = true;
  const failureResponse = await POST(
    webhookRequest(pullRequestBody(), { deliveryId: "delivery-db-failure" }),
  );
  await runAfterCallbacks();
  assert(failureResponse.status === 200, "ledger failure changed webhook response");

  const uninstallBody = JSON.stringify({
    action: "deleted",
    installation: { id: 222 },
  });
  const uninstallResponse = await POST(
    webhookRequest(uninstallBody, {
      deliveryId: "delivery-uninstall",
      eventType: "installation",
    }),
  );
  await runAfterCallbacks();
  const uninstall = deliveryWrites.at(-1)?.create;
  assert(uninstallResponse.status === 200, "uninstall response failed");
  assert(
    uninstall?.resolvedOrganizationId === "org_b" &&
      uninstall?.resolutionStatus === "installation_only",
    "uninstall lost its pre-mutation tenant snapshot",
  );
  assert(installationBindingCleared, "uninstall did not clear the installation binding");

  originalConsole.log(JSON.stringify({
    invalidSignatureRejected: true,
    trustedRoutingEnforced: true,
    unmappedInstallationDropped: true,
    mergedAndMentionScoped: true,
    ledgerFailureNonFatal: true,
    uninstallTenantCaptured: true,
  }));
} catch (error) {
  originalConsole.warn(error);
  process.exitCode = 1;
} finally {
  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
}
