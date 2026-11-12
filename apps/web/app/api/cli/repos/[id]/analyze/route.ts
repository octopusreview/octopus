import "server-only";
import { authenticateApiToken } from "@/lib/api-auth";
import { prisma } from "@octopus/db";
import { analyzeRepository } from "@/lib/analyzer";
import { eventBus } from "@/lib/events/bus";
import { trackInline } from "@/lib/queue-drain-worker";
import { NextRequest } from "next/server";

export async function POST(
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
    where: { id, organizationId: result.org.id, isActive: true, dismissedAt: null },
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
  const claim = await prisma.repository.updateMany({
    where: { id: repo.id, organizationId: result.org.id, isActive: true, dismissedAt: null, analysisStatus: repo.analysisStatus, analyzedAt: repo.analyzedAt, indexStatus: "indexed", indexedAt: repo.indexedAt },
    data: { analysisStatus: "analyzing" },
  });
  if (!claim.count) {
    return Response.json({ error: "Repository state changed or work is already in progress" }, { status: 409 });
  }

  // Tracked until the result or the failure is stored, not only while the analysis runs.
  void trackInline(() => analyzeRepository(repo.id, repo.fullName, result.org.id)
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
    }));

  return Response.json({ message: "Analysis started", repoId: repo.id });
}
