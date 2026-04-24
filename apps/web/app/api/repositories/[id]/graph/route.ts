import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { buildRepoGraph } from "@/lib/repo-graph";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const repo = await prisma.repository.findUnique({
    where: { id },
    select: {
      id: true,
      fullName: true,
      indexStatus: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!repo || repo.organization.members.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  if (repo.indexStatus !== "indexed") {
    return Response.json(
      { error: "Repository is not indexed yet", indexStatus: repo.indexStatus },
      { status: 409 },
    );
  }

  try {
    const graph = await buildRepoGraph(repo.id);
    return Response.json({
      repo: { id: repo.id, fullName: repo.fullName },
      ...graph,
    });
  } catch (err) {
    console.error("[graph] build failed:", err);
    return Response.json(
      { error: "Failed to build graph" },
      { status: 500 },
    );
  }
}
