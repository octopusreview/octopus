import { authenticateApiToken } from "@/lib/api-auth";
import { prisma } from "@octopus/db";
import { runIndexingInBackground } from "@/lib/indexing-runner";
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

  if (repo.indexStatus === "indexing") {
    return Response.json({ error: "Indexing already in progress" }, { status: 409 });
  }

  if (!repo.installationId) {
    return Response.json({ error: "Repository has no installation ID" }, { status: 400 });
  }

  // Mark indexing in-progress synchronously so the CLI's status poll observes
  // the transition, then hand off to the SAME canonical background runner the
  // web path uses. It persists the terminal status plus all stats (counts,
  // contributors, duration, resolved default branch) and generates the repo
  // summary/purpose — so a CLI-triggered index leaves the repo in the exact
  // same shape as a web-triggered one. A fresh AbortController + a no-op log
  // sink are fine here: the CLI polls status rather than subscribing to the
  // pubby channel (its events simply have no listener).
  await prisma.repository.update({
    where: { id: repo.id },
    data: { indexStatus: "indexing" },
  });

  runIndexingInBackground(
    repo.id,
    repo.fullName,
    repo.defaultBranch,
    result.org.id,
    repo.installationId,
    `repo-index-${repo.id}`,
    () => {},
    new AbortController(),
    repo.provider,
  );

  return Response.json({ message: "Indexing started", repoId: repo.id });
}
