import "server-only";
import { prisma, type Prisma } from "@octopus/db";
import { CommunityRepositoryChangedError } from "@/lib/community-pr-persist";

export async function clearTerminalCommunityJobToken(job: {
  id: string; organizationId: string; repositoryId: string; githubToken: string | null;
}): Promise<void> {
  if (job.githubToken == null) return;
  await prisma.communityReviewJob.updateMany({
    where: { id: job.id, organizationId: job.organizationId, repositoryId: job.repositoryId,
      status: { in: ["completed", "failed", "cancelled"] }, githubToken: job.githubToken },
    data: { githubToken: null },
  });
}

export async function completeCommunityReviewJob(
  jobId: string,
  identity: { repositoryId: string; organizationId: string; externalId: string; fullName: string },
  data: Prisma.CommunityReviewJobUpdateManyMutationInput,
): Promise<void> {
  await prisma.$transaction(async tx => {
    const [repo] = await tx.$queryRaw<Array<{ organizationId: string; provider: string; fullName: string; externalId: string }>>`
      SELECT "organizationId", provider, "fullName", "externalId" FROM repositories WHERE id = ${identity.repositoryId} FOR UPDATE
    `;
    if (!repo || repo.organizationId !== identity.organizationId || repo.provider !== "github" ||
        repo.externalId !== identity.externalId || repo.fullName.toLowerCase() !== identity.fullName.toLowerCase()) {
      throw new CommunityRepositoryChangedError("Repository ownership changed during community review");
    }
    const updated = await tx.communityReviewJob.updateMany({
      where: { id: jobId, repositoryId: identity.repositoryId, organizationId: identity.organizationId,
        status: { notIn: ["completed", "failed", "cancelled"] } }, data,
    });
    if (!updated.count) throw new CommunityRepositoryChangedError("Community review ownership changed");
  });
}
