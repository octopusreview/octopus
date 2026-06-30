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

  // Mark analyzing synchronously so the CLI's status poll observes the
  // transition, then persist the result. analyzeRepository only RETURNS the
  // analysis text (the status writes live in reviewer.ts) — persist it here so
  // this CLI route is self-contained.
  await prisma.repository.update({
    where: { id: repo.id },
    data: { analysisStatus: "analyzing" },
  });

  analyzeRepository(repo.id, repo.fullName, result.org.id)
    .then(async (analysis) => {
      await prisma.repository.update({
        where: { id: repo.id },
        data: { analysis, analysisStatus: "analyzed", analyzedAt: new Date() },
      });
      eventBus.emit({
        type: "repo-analyzed",
        orgId: result.org.id,
        repoFullName: repo.fullName,
      });
    })
    .catch(async (err) => {
      console.error(`[cli] Analysis failed for ${repo.fullName}:`, err);
      await prisma.repository
        .update({ where: { id: repo.id }, data: { analysisStatus: "failed" } })
        .catch(() => {});
    });

  return Response.json({ message: "Analysis started", repoId: repo.id });
}
