import { NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { authenticateApiToken } from "@/lib/api-auth";

/**
 * GET /api/agent/llm-tasks?agentId=<id>
 *
 * Claim up to N pending LLM tasks for this agent's organisation. Pending
 * tasks have no agentId yet; this call atomically attaches the calling
 * agent and flips status to "claimed". Returns the claimed task payload
 * the agent needs to run the call.
 *
 * Companion to POST /api/agent/llm-tasks/[id]/complete which delivers the
 * result back.
 */
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

  const agent = await prisma.localAgent.findFirst({
    where: { id: agentId, organizationId: auth.org.id },
  });
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Claim oldest pending tasks for this org. updateMany() returns a count
  // so we re-fetch the claimed rows to return their payload — the alternative
  // is a raw RETURNING query, but updateMany doesn't support it across all
  // Prisma adapters.
  const pending = await prisma.agentLlmTask.findMany({
    where: { organizationId: auth.org.id, status: "pending" },
    orderBy: { createdAt: "asc" },
    take: 5,
    select: { id: true },
  });
  if (pending.length === 0) {
    return NextResponse.json({ tasks: [] });
  }

  const ids = pending.map((p) => p.id);
  const now = new Date();
  await prisma.agentLlmTask.updateMany({
    where: { id: { in: ids }, status: "pending" },
    data: { status: "claimed", agentId, claimedAt: now },
  });

  const tasks = await prisma.agentLlmTask.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      modelId: true,
      system: true,
      messages: true,
      maxTokens: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ tasks });
}
