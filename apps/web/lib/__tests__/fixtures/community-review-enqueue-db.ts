import { mock } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { localQueueTestDatabaseUrl } from "../queue-test-database";

process.env.DATABASE_URL = localQueueTestDatabaseUrl(process.env.DATABASE_URL);
mock.module("server-only", () => ({}));
const { prisma } = await import("@octopus/db");
const { prepareCommunityReviewJob } = await import("@/lib/community-review-enqueue");
const suffix = randomUUID();
const org = await prisma.organization.create({ data: { name: "Synthetic", slug: `enqueue-${suffix}` } });
const repo = await prisma.repository.create({ data: { organizationId: org.id, name: "Synthetic", fullName: `synthetic/${suffix}`, externalId: suffix, provider: "github" } });
const input = { repositoryId: repo.id, organizationId: org.id, externalId: repo.externalId, fullName: repo.fullName,
  prNumber: 1, headSha: "synthetic", postMode: "bot_account" as const, deduplicate: true, reuseCompleted: true,
  data: () => ({ status: "indexing", diff: "synthetic", expiresAt: new Date(Date.now() + 60_000) }) };
try {
  const created = await prepareCommunityReviewJob(input);
  assert.equal(created.kind, "created");
  if (created.kind !== "created") throw new Error("job was not created");
  const id = created.job.id;
  assert.deepEqual(await prepareCommunityReviewJob(input), { kind: "existing", job: { id } });
  await prisma.communityReviewJob.update({ where: { id }, data: { status: "completed" } });
  const action = await prepareCommunityReviewJob({ ...input, postMode: "action_client", reuseCompleted: false });
  assert.equal(action.kind, "created");
  assert.deepEqual(await prepareCommunityReviewJob(input), { kind: "conflict" });
  await prisma.communityReviewJob.update({ where: { id }, data: { status: "reviewing" } });
  assert.deepEqual(await prepareCommunityReviewJob(input), { kind: "conflict" });
  assert.deepEqual(await prepareCommunityReviewJob({ ...input, postMode: "action_client", reuseCompleted: false }), { kind: "conflict" });
} finally {
  await prisma.communityReviewJob.deleteMany({ where: { repositoryId: repo.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.$disconnect();
}
