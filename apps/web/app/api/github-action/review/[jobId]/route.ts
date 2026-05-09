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

  // Auth: caller must supply the repoFullName that matches this job.
  // Querystring keeps the action client simple (no body on GET).
  const url = new URL(request.url);
  const repoFullName = url.searchParams.get("repo");
  if (!repoFullName) {
    return Response.json(
      { error: "Missing 'repo' query parameter (owner/name)" },
      { status: 400 },
    );
  }

  const job = await prisma.communityReviewJob.findUnique({ where: { id: jobId } });

  if (!job) {
    LOG(`jobId=${jobId} not found`);
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.repoFullName !== repoFullName) {
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
    LOG(`jobId=${jobId} returning failed: ${job.errorMessage}`);
    return Response.json({
      status: "failed",
      jobId: job.id,
      error: job.errorMessage ?? "Review failed",
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
