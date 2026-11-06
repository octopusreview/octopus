import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { getSyncLogs } from "@/lib/elasticsearch";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const orgId = searchParams.get("orgId");
  const repoId = searchParams.get("repoId");

  if (!orgId || !repoId) {
    return NextResponse.json({ error: "Missing orgId or repoId" }, { status: 400 });
  }

  // Verify user is a member of the org
  const member = await prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId: session.user.id,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const repo = await prisma.repository.findFirst({
    where: { id: repoId, organizationId: orgId },
    select: { indexAttemptId: true, syncLogAttemptId: true },
  });
  if (!repo) return NextResponse.json({ logs: [] });
  const attempt = repo.indexAttemptId && repo.indexAttemptId === repo.syncLogAttemptId ? repo.indexAttemptId : undefined;
  const logs = await getSyncLogs(orgId, repoId, 500, attempt);

  return NextResponse.json({ logs, attempt: attempt ?? null });
}
