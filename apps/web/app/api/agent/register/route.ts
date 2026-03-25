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
  const { name, repoFullNames, capabilities, machineInfo } = body;

  if (!name || !Array.isArray(repoFullNames)) {
    return NextResponse.json(
      { error: "name and repoFullNames are required" },
      { status: 400 },
    );
  }

  const agent = await prisma.localAgent.upsert({
    where: {
      organizationId_name: {
        organizationId: auth.org.id,
        name,
      },
    },
    update: {
      status: "online",
      lastSeenAt: new Date(),
      repoFullNames: repoFullNames,
      capabilities: capabilities ?? [],
      machineInfo: machineInfo ?? null,
      apiTokenId: auth.token.id,
    },
    create: {
      name,
      status: "online",
      lastSeenAt: new Date(),
      repoFullNames: repoFullNames,
      capabilities: capabilities ?? [],
      machineInfo: machineInfo ?? null,
      organizationId: auth.org.id,
      apiTokenId: auth.token.id,
    },
  });

  // Notify org that an agent came online
  pubby
    .trigger(`presence-org-${auth.org.id}`, "agent-online", {
      agentId: agent.id,
      name: agent.name,
      repos: repoFullNames,
      capabilities: capabilities ?? [],
    })
    .catch(() => {});

  return NextResponse.json({
    agentId: agent.id,
    channel: `private-agent-org-${auth.org.id}`,
    orgId: auth.org.id,
  });
}
