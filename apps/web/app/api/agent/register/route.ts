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
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { name, repoFullNames, capabilities, machineInfo } = body;

  if (
    typeof name !== "string" ||
    name.trim().length === 0 ||
    !Array.isArray(repoFullNames) ||
    !repoFullNames.every((repo) => typeof repo === "string") ||
    (capabilities !== undefined &&
      (!Array.isArray(capabilities) ||
        !capabilities.every((capability) => typeof capability === "string")))
  ) {
    return NextResponse.json(
      { error: "name, repoFullNames, and capabilities must be valid" },
      { status: 400 },
    );
  }

  const now = new Date();
  const updateData = {
    status: "online",
    lastSeenAt: now,
    repoFullNames,
    capabilities: capabilities ?? [],
    machineInfo: machineInfo ?? null,
    apiTokenId: auth.token.id,
  };
  const registrationWhere = {
    organizationId: auth.org.id,
    name,
    OR: [
      { apiTokenId: auth.token.id },
      { apiToken: { is: { deletedAt: { not: null } } } },
      { apiToken: { is: { expiresAt: { lt: now } } } },
    ],
  };

  const updateRegistration = () =>
    prisma.localAgent.updateMany({
      where: registrationWhere,
      data: updateData,
    });
  const findRegistration = () =>
    prisma.localAgent.findUnique({
      where: {
        organizationId_name: {
          organizationId: auth.org.id,
          name,
        },
      },
    });

  let agent;
  const updated = await updateRegistration();
  if (updated.count > 0) {
    agent = await findRegistration();
  } else {
    try {
      agent = await prisma.localAgent.create({
        data: {
          name,
          organizationId: auth.org.id,
          ...updateData,
        },
      });
    } catch (error) {
      // A concurrent registration may have won the unique (org, name) race.
      // Retry only through the same atomic ownership/retirement predicate.
      const raced = await updateRegistration();
      if (raced.count > 0) {
        agent = await findRegistration();
      } else if (await findRegistration()) {
        return NextResponse.json(
          { error: "Agent name is already registered to another active token" },
          { status: 409 },
        );
      } else {
        throw error;
      }
    }
  }

  if (!agent) {
    return NextResponse.json(
      { error: "Agent registration changed concurrently; retry" },
      { status: 409 },
    );
  }

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
