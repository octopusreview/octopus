import "server-only";

import { NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { authenticateApiToken } from "@/lib/api-auth";

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

  const { agentId, repoFullNames } = body;

  if (typeof agentId !== "string" || agentId.length === 0) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }
  if (
    repoFullNames !== undefined &&
    (!Array.isArray(repoFullNames) ||
      !repoFullNames.every((repo) => typeof repo === "string"))
  ) {
    return NextResponse.json(
      { error: "repoFullNames must be an array of strings" },
      { status: 400 },
    );
  }

  const updated = await prisma.localAgent.updateMany({
    where: {
      id: agentId,
      organizationId: auth.org.id,
      apiTokenId: auth.token.id,
    },
    data: {
      lastSeenAt: new Date(),
      status: "online",
      ...(Array.isArray(repoFullNames) ? { repoFullNames } : {}),
    },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
