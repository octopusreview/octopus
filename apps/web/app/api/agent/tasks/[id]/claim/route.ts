import "server-only";

import { NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { authenticateApiToken } from "@/lib/api-auth";
import { isPostgresSafeText, readBoundedJson } from "@/lib/bounded-json";

const MAX_CLAIM_BODY_BYTES = 16 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isPostgresSafeText(id)) {
    await request.body?.cancel().catch(() => {});
    return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
  }

  const parsedBody = await readBoundedJson(request, MAX_CLAIM_BODY_BYTES);
  if (!parsedBody.ok) {
    const tooLarge = parsedBody.reason === "too_large";
    return NextResponse.json(
      { error: tooLarge ? "Request body too large" : "Invalid request body" },
      { status: tooLarge ? 413 : 400 },
    );
  }
  const body = parsedBody.value;
  const agentId =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).agentId
      : undefined;

  if (
    typeof agentId !== "string" ||
    agentId.trim().length === 0 ||
    !isPostgresSafeText(agentId)
  ) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  // The agent id is caller-controlled. Bind it to both the authenticated API
  // token and organization before using its repository scope.
  const agent = await prisma.localAgent.findFirst({
    where: {
      id: agentId,
      organizationId: auth.org.id,
      apiTokenId: auth.token.id,
    },
    select: { repoFullNames: true },
  });

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const repoFullNames = Array.isArray(agent.repoFullNames)
    ? agent.repoFullNames.filter(
        (repo): repo is string => typeof repo === "string",
      )
    : [];

  // Atomic claim: only while pending and only for a repository the
  // authenticated agent declared that it watches.
  const result = await prisma.agentSearchTask.updateMany({
    where: {
      id,
      organizationId: auth.org.id,
      status: "pending",
      repoFullName: { in: repoFullNames },
    },
    data: {
      status: "claimed",
      agentId,
      claimedAt: new Date(),
    },
  });

  if (result.count === 0) {
    return NextResponse.json(
      { error: "Task not found or already claimed" },
      { status: 409 },
    );
  }

  // Return full task details for the agent to execute
  const task = await prisma.agentSearchTask.findFirst({
    where: {
      id,
      organizationId: auth.org.id,
      agentId,
      status: "claimed",
    },
  });

  if (!task) {
    return NextResponse.json(
      { error: "Task changed state before it could be returned" },
      { status: 409 },
    );
  }

  return NextResponse.json({ task });
}
