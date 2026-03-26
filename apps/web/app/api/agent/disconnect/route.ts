import { NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { authenticateApiToken } from "@/lib/api-auth";
import { pubby } from "@/lib/pubby";

export async function POST(request: Request) {
  const auth = await authenticateApiToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { agentId } = body;

  if (!agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  const agent = await prisma.localAgent.findFirst({
    where: {
      id: agentId,
      organizationId: auth.org.id,
    },
  });

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  await prisma.localAgent.update({
    where: { id: agentId },
    data: { status: "offline" },
  });

  // Notify org that agent went offline
  pubby
    .trigger(`presence-org-${auth.org.id}`, "agent-offline", {
      agentId: agent.id,
      name: agent.name,
    })
    .catch(() => {});

  return NextResponse.json({ ok: true });
}
