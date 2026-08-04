import "server-only";

import { NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { authenticateApiToken } from "@/lib/api-auth";
import { isPostgresSafeText } from "@/lib/bounded-json";

export async function GET(request: Request) {
  const auth = await authenticateApiToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agentId");

  if (!agentId || !isPostgresSafeText(agentId)) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  // Bind the caller to the agent record created with this API token. An
  // organization can have multiple agent tokens, so org membership alone is
  // not enough to authorize another agent's repository scope.
  const agent = await prisma.localAgent.findFirst({
    where: {
      id: agentId,
      organizationId: auth.org.id,
      apiTokenId: auth.token.id,
    },
  });

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const agentRepos = agent.repoFullNames as string[];

  // Find pending tasks for repos this agent watches
  const tasks = await prisma.agentSearchTask.findMany({
    where: {
      organizationId: auth.org.id,
      status: "pending",
      repoFullName: { in: agentRepos },
    },
    orderBy: { createdAt: "asc" },
    take: 5,
  });

  return NextResponse.json({ tasks });
}
