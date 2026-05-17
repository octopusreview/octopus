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
  // updateMany's WHERE clause atomically prevents double-claim of the same
  // row, but we cannot trust the SELECT we ran above — another agent may
  // have raced us between the SELECT and the updateMany. The .count here
  // is how many rows WE claimed; if it's zero, the other agent got every
  // pending task in our batch.
  const claimed = await prisma.agentLlmTask.updateMany({
    where: { id: { in: ids }, status: "pending" },
    data: { status: "claimed", agentId, claimedAt: now },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ tasks: [] });
  }

  // Re-fetch only the tasks WE actually claimed — filter by our agentId
  // and status="claimed" so we never hand a task another agent owns back
  // to this caller. (Without this filter, the /complete endpoint's
  // status-only check would let a non-owning agent overwrite results.)
  const tasks = await prisma.agentLlmTask.findMany({
    where: { id: { in: ids }, agentId, status: "claimed" },
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
