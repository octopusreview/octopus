import { authenticateApiToken } from "@/lib/api-auth";
import { prisma } from "@octopus/db";

export async function GET(request: Request) {
  const result = await authenticateApiToken(request);
  if (result instanceof Response) return result; // account-standing hold (403), pass through
  if (!result) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const repos = await prisma.repository.findMany({
    where: { organizationId: result.org.id, isActive: true },
    select: {
      id: true,
      name: true,
      fullName: true,
      provider: true,
      defaultBranch: true,
      indexStatus: true,
      indexedAt: true,
      indexedFiles: true,
      totalFiles: true,
      totalChunks: true,
      analysisStatus: true,
      analyzedAt: true,
      autoReview: true,
      summary: true,
      purpose: true,
      _count: { select: { pullRequests: true } },
    },
    orderBy: { fullName: "asc" },
  });

  return Response.json({ repos });
}
