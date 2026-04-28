import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { getSyncLogs } from "@/lib/elasticsearch";

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.ADMIN_API_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization");
  if (!header) return false;
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  return token === expected;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const repo = await prisma.repository.findUnique({
    where: { id },
    select: { id: true, organizationId: true },
  });

  if (!repo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  const logs = await getSyncLogs(repo.organizationId, repo.id);
  return NextResponse.json({ logs });
}
