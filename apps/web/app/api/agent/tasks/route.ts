import { NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { authenticateApiToken } from "@/lib/api-auth";

export async function GET(request: Request) {
  const auth = await authenticateApiToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agentId");

  if (!agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  // Verify agent belongs to this org
  const agent = await prisma.localAgent.findFirst({
    where: {
      id: agentId,
      organizationId: auth.org.id,
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
