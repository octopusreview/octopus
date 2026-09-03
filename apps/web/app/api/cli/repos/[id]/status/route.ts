import { authenticateApiToken } from "@/lib/api-auth";
import { prisma } from "@octopus/db";
import { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await authenticateApiToken(request);
  if (result instanceof Response) return result; // account-standing hold (403), pass through
  if (!result) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const repo = await prisma.repository.findFirst({
    where: { id, organizationId: result.org.id, isActive: true },
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
      totalVectors: true,
      indexDurationMs: true,
      analysisStatus: true,
      analyzedAt: true,
      analysis: true,
      summary: true,
      purpose: true,
      autoReview: true,
      contributorCount: true,
      _count: { select: { pullRequests: true } },
    },
  });

  if (!repo) {
    return Response.json({ error: "Repository not found" }, { status: 404 });
  }

  return Response.json({ repo });
}
