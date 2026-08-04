import "server-only";

import { NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { authenticateApiToken } from "@/lib/api-auth";
import { isPostgresSafeText, readBoundedJson } from "@/lib/bounded-json";
import { pubby } from "@/lib/pubby";

const MAX_DISCONNECT_BODY_BYTES = 16 * 1024;

export async function POST(request: Request) {
  const auth = await authenticateApiToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedBody = await readBoundedJson(request, MAX_DISCONNECT_BODY_BYTES);
  if (!parsedBody.ok) {
    const tooLarge = parsedBody.reason === "too_large";
    return NextResponse.json(
      { error: tooLarge ? "Request body too large" : "Invalid request body" },
      { status: tooLarge ? 413 : 400 },
    );
  }
  const body = parsedBody.value;
  const agentId =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).agentId
      : undefined;

  if (
    typeof agentId !== "string" ||
    agentId.length === 0 ||
    !isPostgresSafeText(agentId)
  ) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
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

  const agent = await prisma.localAgent.findFirst({
    where: {
      id: agentId,
      organizationId: auth.org.id,
      apiTokenId: auth.token.id,
    },
    select: { name: true },
  });

  // Notify org that agent went offline
  pubby
    .trigger(`presence-org-${auth.org.id}`, "agent-offline", {
      agentId,
      name: agent?.name ?? null,
    })
    .catch(() => {});

  return NextResponse.json({ ok: true });
}
