import "server-only";

import { NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { authenticateApiToken } from "@/lib/api-auth";
import { pubby } from "@/lib/pubby";

export async function POST(request: Request) {
  const auth = await authenticateApiToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const agentId =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).agentId
      : undefined;

  if (typeof agentId !== "string" || agentId.length === 0) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

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

  const updated = await prisma.localAgent.updateMany({
    where: {
      id: agentId,
      organizationId: auth.org.id,
      apiTokenId: auth.token.id,
    },
    data: { status: "offline" },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Notify org that agent went offline
  pubby
    .trigger(`presence-org-${auth.org.id}`, "agent-offline", {
      agentId: agent.id,
      name: agent.name,
    })
    .catch(() => {});

  return NextResponse.json({ ok: true });
}
