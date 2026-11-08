import "server-only";
import { prisma, type Prisma } from "@octopus/db";

type JobData = Omit<Prisma.CommunityReviewJobUncheckedCreateInput,
  "repositoryId" | "organizationId" | "repositoryExternalId" | "repoFullName" | "prNumber" | "headSha" | "postMode">;

export async function prepareCommunityReviewJob(input: {
  repositoryId: string; organizationId: string; externalId: string; fullName: string;
  postMode: "action_client" | "bot_account";
  prNumber?: number | null; headSha?: string | null;
  deduplicate: boolean; reuseCompleted: boolean; data: () => JobData;
}) {
  return prisma.$transaction(async tx => {
    const [repo] = await tx.$queryRaw<Array<{ provider: string; externalId: string; fullName: string }>>`
      SELECT provider, "externalId", "fullName" FROM repositories
      WHERE id = ${input.repositoryId} AND "organizationId" = ${input.organizationId} FOR UPDATE
    `;
    if (!repo || repo.provider !== "github" || repo.externalId !== input.externalId ||
        repo.fullName.toLowerCase() !== input.fullName.toLowerCase()) return { kind: "conflict" as const };

    if (input.deduplicate) {
      const common = { repositoryId: input.repositoryId, prNumber: input.prNumber ?? null,
        headSha: input.headSha ?? null };
      const existing = await tx.communityReviewJob.findFirst({
        where: { ...common, organizationId: input.organizationId, postMode: input.postMode, expiresAt: { gt: new Date() },
          repoFullName: { equals: input.fullName, mode: "insensitive" },
          OR: [{ repositoryExternalId: input.externalId }, { repositoryExternalId: null }],
          status: { in: input.reuseCompleted ? ["indexing", "reviewing", "completed"] : ["indexing", "reviewing"] } },
        orderBy: { createdAt: "desc" }, select: { id: true },
      });
      const conflicting = await tx.communityReviewJob.findFirst({
        where: { ...common, status: { in: ["indexing", "reviewing"] }, ...(existing ? { id: { not: existing.id } } : {}) }, select: { id: true },
      });
      if (conflicting) return { kind: "conflict" as const };
      if (existing) return { kind: "existing" as const, job: existing };
    }

    const job = await tx.communityReviewJob.create({ data: { ...input.data(), repositoryId: input.repositoryId,
      organizationId: input.organizationId, repositoryExternalId: input.externalId, repoFullName: input.fullName,
      postMode: input.postMode, prNumber: input.prNumber ?? null, headSha: input.headSha ?? null } });
    return { kind: "created" as const, job };
  });
}
