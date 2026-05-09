import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { enqueue } from "@/lib/queue";

const STALE_REVIEW_MS = 3 * 60 * 1000;

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.ADMIN_API_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization");
  if (!header) return false;
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  return token === expected;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const pr = await prisma.pullRequest.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      status: true,
      updatedAt: true,
      repositoryId: true,
    },
  });

  if (!pr) {
    return NextResponse.json({ error: "Pull request not found" }, { status: 404 });
  }

  // Block retry if a review is actively running (and not stuck) — pg-boss
  // already retries failed jobs, and processReview's claim logic prevents
  // duplicate workers, but enqueuing on top of an in-flight review is wasteful.
  if (pr.status === "reviewing" || pr.status === "pending" || pr.status === "queued") {
    const elapsed = Date.now() - pr.updatedAt.getTime();
    if (elapsed < STALE_REVIEW_MS) {
      return NextResponse.json(
        { error: `Review is already ${pr.status}` },
        { status: 409 },
      );
    }
  }

  await prisma.pullRequest.update({
    where: { id: pr.id },
    data: {
      status: "pending",
      errorMessage: null,
      reviewBody: null,
    },
  });

  await enqueue("process-review", { pullRequestId: pr.id });

  return NextResponse.json({ message: "Review retry enqueued", pullRequestId: pr.id });
}
