import "server-only";
import { prisma } from "@octopus/db";
import { NextRequest } from "next/server";

const LOG = (msg: string, ...rest: unknown[]) =>
  console.log(`[github-action/poll] ${msg}`, ...rest);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;

  if (!jobId || !UUID_RE.test(jobId)) {
    return Response.json({ error: "Invalid jobId" }, { status: 400 });
  }

  // The action supplies the repository name in the query string.
  const url = new URL(request.url);
  const repoFullName = url.searchParams.get("repo");
  if (!repoFullName) {
    return Response.json(
      { error: "Missing 'repo' query parameter (owner/name)" },
      { status: 400 },
    );
  }

  const job = await prisma.$transaction(async (tx) => {
    const initial = await tx.communityReviewJob.findUnique({ where: { id: jobId }, select: { repositoryId: true } });
    if (!initial) return null;
    const [repo] = await tx.$queryRaw<Array<{ organizationId: string; provider: string; externalId: string; fullName: string }>>`
      SELECT "organizationId", provider, "externalId", "fullName" FROM repositories
      WHERE id = ${initial.repositoryId} FOR SHARE
    `;
    if (!repo) return null;
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM community_review_jobs WHERE id = ${jobId} AND "repositoryId" = ${initial.repositoryId} FOR SHARE
    `;
    if (!locked) return null;
    const current = await tx.communityReviewJob.findUnique({ where: { id: jobId }, select: {
      id: true, repositoryId: true, organizationId: true, repositoryExternalId: true, repoFullName: true,
      expiresAt: true, status: true, findings: true, summary: true, model: true, indexed: true,
      firstCommunityReview: true, usage: true, errorMessage: true, startedAt: true, attempts: true,
    } });
    if (!current || current.organizationId !== repo.organizationId || repo.provider !== "github" ||
        (current.repositoryExternalId !== null && current.repositoryExternalId !== repo.externalId) ||
        current.repoFullName.toLowerCase() !== repo.fullName.toLowerCase()) return null;
    return current;
  });

  if (!job) {
    LOG(`jobId=${jobId} not found`);
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.repoFullName.toLowerCase() !== repoFullName.toLowerCase()) {
    LOG(`jobId=${jobId} repo mismatch: stored=${job.repoFullName} provided=${repoFullName}`);
    return Response.json({ error: "Repo mismatch" }, { status: 403 });
  }

  if (job.expiresAt < new Date()) {
    LOG(`jobId=${jobId} expired (expiresAt=${job.expiresAt.toISOString()})`);
    return Response.json({ status: "expired", error: "Job expired" }, { status: 410 });
  }

  if (job.status === "completed") {
    LOG(`jobId=${jobId} returning completed result`);
    return Response.json({
      status: "completed",
      jobId: job.id,
      findings: job.findings ?? [],
      summary: job.summary ?? "",
      model: job.model ?? "",
      indexed: job.indexed,
      community: true,
      firstCommunityReview: job.firstCommunityReview,
      usage: job.usage ?? undefined,
    });
  }

  if (job.status === "failed") {
    LOG(`jobId=${jobId} returning failed`);
    return Response.json({
      status: "failed",
      jobId: job.id,
      error: "Review failed",
    });
  }

  // In-flight: indexing | reviewing
  return Response.json({
    status: job.status,
    jobId: job.id,
    startedAt: job.startedAt,
    attempts: job.attempts,
  });
}
