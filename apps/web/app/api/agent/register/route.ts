import "server-only";

import { NextResponse } from "next/server";
import { prisma, type Prisma } from "@octopus/db";
import { authenticateApiToken } from "@/lib/api-auth";
import {
  isBoundedStringArray,
  isPostgresSafeJson,
  isPostgresSafeText,
  MAX_REPO_FULL_NAME_CODE_UNITS,
  MAX_REPO_FULL_NAMES,
  readBoundedJson,
} from "@/lib/bounded-json";
import { PRISMA_DB_NULL } from "@/lib/prisma-json-null";
import { pubby } from "@/lib/pubby";

const MAX_REGISTER_BODY_BYTES = 256 * 1024;
const MAX_NAME_CODE_UNITS = 200;
const MAX_CAPABILITIES = 50;
const MAX_CAPABILITY_CODE_UNITS = 100;
const MAX_MACHINE_INFO_BYTES = 8 * 1024;

export async function POST(request: Request) {
  const auth = await authenticateApiToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedBody = await readBoundedJson(request, MAX_REGISTER_BODY_BYTES);
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

  const { name, repoFullNames, capabilities, machineInfo } = body as Record<
    string,
    unknown
  >;

  if (
    typeof name !== "string" ||
    name.trim().length === 0 ||
    name.length > MAX_NAME_CODE_UNITS ||
    !isPostgresSafeText(name) ||
    !isBoundedStringArray(
      repoFullNames,
      MAX_REPO_FULL_NAMES,
      MAX_REPO_FULL_NAME_CODE_UNITS,
    ) ||
    (capabilities !== undefined &&
      !isBoundedStringArray(
        capabilities,
        MAX_CAPABILITIES,
        MAX_CAPABILITY_CODE_UNITS,
      ))
  ) {
    return NextResponse.json(
      { error: "name, repoFullNames, and capabilities must be valid" },
      { status: 400 },
    );
  }

  let machineInfoValid = machineInfo == null;
  if (!machineInfoValid) {
    try {
      machineInfoValid =
        typeof machineInfo === "object" &&
        !Array.isArray(machineInfo) &&
        isPostgresSafeJson(machineInfo) &&
        new TextEncoder().encode(JSON.stringify(machineInfo)).byteLength <=
          MAX_MACHINE_INFO_BYTES;
    } catch {
      machineInfoValid = false;
    }
  }
  if (!machineInfoValid) {
    return NextResponse.json(
      {
        error: `machineInfo must be a JSON object of at most ${MAX_MACHINE_INFO_BYTES} bytes`,
      },
      { status: 400 },
    );
  }
  const storedMachineInfo =
    machineInfo == null
      ? PRISMA_DB_NULL
      : (machineInfo as Prisma.InputJsonObject);

  const now = new Date();
  const updateData = {
    status: "online",
    lastSeenAt: now,
    repoFullNames,
    capabilities: capabilities ?? [],
    machineInfo: storedMachineInfo,
    apiTokenId: auth.token.id,
  };
  // apiTokenId is NOT NULL and its foreign key uses ON DELETE CASCADE, so a
  // hard-deleted token removes this row and frees (organizationId, name).
  // Persisted names are reclaimable only through the owned, soft-deleted, or
  // expired-token cases below; an active foreign token remains protected.
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
