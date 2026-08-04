import "server-only";

import { NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { authenticateApiToken } from "@/lib/api-auth";
import {
  isBoundedStringArray,
  isPostgresSafeText,
  MAX_REPO_FULL_NAME_CODE_UNITS,
  MAX_REPO_FULL_NAMES,
  readBoundedJson,
} from "@/lib/bounded-json";

const MAX_HEARTBEAT_BODY_BYTES = 256 * 1024;

export async function POST(request: Request) {
  const auth = await authenticateApiToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedBody = await readBoundedJson(request, MAX_HEARTBEAT_BODY_BYTES);
  if (!parsedBody.ok) {
    const tooLarge = parsedBody.reason === "too_large";
    return NextResponse.json(
      { error: tooLarge ? "Request body too large" : "Invalid request body" },
      { status: tooLarge ? 413 : 400 },
    );
  }

  const body = parsedBody.value;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { agentId, repoFullNames } = body as Record<string, unknown>;

  if (
    typeof agentId !== "string" ||
    agentId.length === 0 ||
    !isPostgresSafeText(agentId)
  ) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }
  if (
    repoFullNames !== undefined &&
    !isBoundedStringArray(
      repoFullNames,
      MAX_REPO_FULL_NAMES,
      MAX_REPO_FULL_NAME_CODE_UNITS,
    )
  ) {
    return NextResponse.json(
      {
        error: `repoFullNames must be an array of at most ${MAX_REPO_FULL_NAMES} strings`,
      },
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
      ...(repoFullNames !== undefined ? { repoFullNames } : {}),
    },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
