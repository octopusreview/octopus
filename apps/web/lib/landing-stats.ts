import { prisma } from "@octopus/db";

export type LandingStats = {
  chunks: number;
  findings: number;
  reviews: number;
  repositories: number;
};

export async function getLandingStats(): Promise<LandingStats> {
  const [chunkAgg, knowledgeChunkAgg, findings, reviews, repositories] =
    await Promise.all([
      prisma.repository.aggregate({ _sum: { totalChunks: true } }),
      prisma.knowledgeDocument.aggregate({
        _sum: { totalChunks: true },
        where: { deletedAt: null, status: "ready" },
      }),
      prisma.reviewIssue.count({ where: { deletedAt: null } }),
      prisma.pullRequest.count({ where: { status: "completed" } }),
      prisma.repository.count({ where: { isActive: true } }),
    ]);

  return {
    chunks:
      (chunkAgg._sum.totalChunks ?? 0) +
      (knowledgeChunkAgg._sum.totalChunks ?? 0),
    findings,
    reviews,
    repositories,
  };
}
