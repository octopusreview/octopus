import { mock } from "bun:test";
import assert from "node:assert/strict";

const failure = new Error("synthetic database failure");
let stage = "start";
mock.module("server-only", () => ({}));
mock.module("@octopus/db", () => ({ prisma: {
  $transaction: async (fn: (tx: unknown) => Promise<void>) => {
    if (stage === "start") throw failure;
    return fn({
      $queryRaw: async () => {
        if (stage === "lookup") throw failure;
        return [{ organizationId: "org", provider: "github", fullName: "owner/repo", externalId: "1" }];
      },
      pullRequest: { upsert: async () => { throw failure; } },
    });
  },
} }));
const { persistCommunityReviewToPR, CommunityRepositoryChangedError } = await import("@/lib/community-pr-persist");
const input = { repositoryId: "repo", organizationId: "org", externalId: "1", fullName: "owner/repo", prNumber: 1, summary: "synthetic", findings: [] };
for (stage of ["start", "lookup"]) {
  await assert.rejects(() => persistCommunityReviewToPR(input), (error: unknown) =>
    error instanceof CommunityRepositoryChangedError && error.message === "Could not establish repository ownership" && error.cause === undefined);
}
stage = "write";
await assert.rejects(() => persistCommunityReviewToPR(input), (error: unknown) => error === failure);
