import { NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { authenticateApiToken } from "@/lib/api-auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { agentId } = body;

  if (!agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  // Atomic claim: only if status is still "pending"
  const result = await prisma.agentSearchTask.updateMany({
    where: {
      id,
      organizationId: auth.org.id,
      status: "pending",
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
  const task = await prisma.agentSearchTask.findUnique({
    where: { id },
  });

  return NextResponse.json({ task });
}
