import { authenticateApiToken } from "@/lib/api-auth";
import { prisma } from "@octopus/db";
import { generateLocalReview } from "@/lib/review-core";
import { isOrgOverSpendLimit } from "@/lib/cost";
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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { diff, title, author, fileTree } = body as {
    diff?: string;
    title?: string;
    author?: string;
    fileTree?: string[];
  };

  if (!diff || typeof diff !== "string") {
    return Response.json({ error: "Missing or invalid 'diff' field" }, { status: 400 });
  }

  // 500KB max
  if (diff.length > 500_000) {
    return Response.json({ error: "Diff too large (max 500KB)" }, { status: 413 });
  }

  if (await isOrgOverSpendLimit(result.org.id)) {
    return Response.json({ error: "Monthly spend limit reached" }, { status: 402 });
  }

  try {
    const reviewResult = await generateLocalReview({
      diff,
      repoId: repo.id,
      orgId: result.org.id,
      title: typeof title === "string" ? title : undefined,
      author: typeof author === "string" ? author : undefined,
      fileTree: Array.isArray(fileTree) ? fileTree : undefined,
    });

    return Response.json({
      findings: reviewResult.findings,
      summary: reviewResult.summary,
      model: reviewResult.model,
      usage: reviewResult.usage,
    });
  } catch (err) {
    console.error("[local-review] Review generation failed:", err);
    return Response.json({ error: "Review generation failed" }, { status: 500 });
  }
}
