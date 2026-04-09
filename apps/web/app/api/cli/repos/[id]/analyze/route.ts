import { authenticateApiToken } from "@/lib/api-auth";
import { prisma } from "@octopus/db";
import { analyzeRepository } from "@/lib/analyzer";
import { eventBus } from "@/lib/events/bus";
import { NextRequest } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await authenticateApiToken(request);
  if (!result) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const repo = await prisma.repository.findFirst({
    where: { id, organizationId: result.org.id, isActive: true },
  });

  if (!repo) {
    return Response.json({ error: "Repository not found" }, { status: 404 });
  }

  if (repo.indexStatus !== "indexed") {
    return Response.json(
      { error: "Repository must be indexed before analysis" },
      { status: 400 },
    );
  }

  if (repo.analysisStatus === "analyzing") {
    return Response.json({ error: "Analysis already in progress" }, { status: 409 });
  }

  // Start analysis in the background
  analyzeRepository(repo.id, repo.fullName, result.org.id)
    .then(() => {
      eventBus.emit({
        type: "repo-analyzed",
        orgId: result.org.id,
        repoFullName: repo.fullName,
      });
    })
    .catch((err) => {
      console.error(`[cli] Analysis failed for ${repo.fullName}:`, err);
    });

  return Response.json({ message: "Analysis started", repoId: repo.id });
}
