import "server-only";

import { NextResponse } from "next/server";
import { prisma, type Prisma } from "@octopus/db";
import { authenticateApiToken } from "@/lib/api-auth";
import {
  isPostgresSafeText,
  readBoundedJson,
  sanitizePostgresJson,
  sanitizePostgresText,
  truncateStringSafe,
} from "@/lib/bounded-json";
import { PRISMA_DB_NULL } from "@/lib/prisma-json-null";
import { pubby } from "@/lib/pubby";

const MAX_RESULT_BODY_BYTES = 1024 * 1024; // 1 MiB
const MAX_STORED_RESULT_BYTES = 50 * 1024; // 50 KiB
const MAX_SUMMARY_CODE_UNITS = 15 * 1024;
const MAX_ANSWER_SUMMARY_CODE_UNITS = 100 * 1024;
const MAX_ERROR_CODE_UNITS = 1_000;
const OVERSIZED_RESULT_ERROR =
  "Agent result exceeded the 1 MiB transport limit";
const TERMINAL_STATUSES = new Set(["completed", "failed", "timeout"]);

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function truncateJsonResult(value: unknown): Prisma.InputJsonValue {
  const normalized = (sanitizePostgresJson(value) ??
    null) as Prisma.InputJsonValue;
  const serialized = JSON.stringify(normalized) ?? "null";
  const originalSizeBytes = new TextEncoder().encode(serialized).byteLength;

  if (originalSizeBytes <= MAX_STORED_RESULT_BYTES) {
    return normalized;
  }

  // Preserve the caller's top-level JSON type: array/object payloads keep the
  // largest whole-member prefix that fits, and string payloads keep the
  // largest surrogate-safe prefix. This avoids introducing a wrapper shape
  // that a future diagnostic reader could mistake for the agent's result.
  let length: number;
  let candidate: (end: number) => Prisma.InputJsonValue;

  if (typeof normalized === "string") {
    length = normalized.length;
    candidate = (end) => truncateStringSafe(normalized, end);
  } else if (Array.isArray(normalized)) {
    length = normalized.length;
    candidate = (end) => normalized.slice(0, end) as Prisma.InputJsonArray;
  } else if (typeof normalized === "object" && normalized !== null) {
    const entries = Object.entries(normalized);
    length = entries.length;
    candidate = (end) =>
      Object.fromEntries(entries.slice(0, end)) as Prisma.InputJsonObject;
  } else {
    // JSON scalars are always well below the storage cap.
    return normalized;
  }

  let low = 0;
  let high = length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    if (jsonByteLength(candidate(midpoint)) <= MAX_STORED_RESULT_BYTES) {
      low = midpoint;
    } else {
      high = midpoint - 1;
    }
  }

  return candidate(low);
}

function ownedClaimedTaskWhere(
  id: string,
  organizationId: string,
  agentId: string,
  apiTokenId: string,
): Prisma.AgentSearchTaskWhereInput {
  return {
    id,
    organizationId,
    agentId,
    status: "claimed",
    agent: {
      is: {
        organizationId,
        apiTokenId,
      },
    },
  };
}

async function terminalRaceResponse(
  id: string,
  organizationId: string,
  agentId: string,
  apiTokenId: string,
) {
  const current = await prisma.agentSearchTask.findFirst({
    where: {
      id,
      organizationId,
      agentId,
      agent: {
        is: {
          organizationId,
          apiTokenId,
        },
      },
    },
    select: { status: true },
  });

  if (current && TERMINAL_STATUSES.has(current.status)) {
    return NextResponse.json({ ok: true, status: current.status });
  }

  return NextResponse.json(
    { error: "Task result could not be recorded" },
    { status: 409 },
  );
}

function publishCompletion(
  organizationId: string,
  taskId: string,
  status: "completed" | "failed",
) {
  pubby
    .trigger(`private-agent-org-${organizationId}`, "agent-search-complete", {
      taskId,
      status,
    })
    .catch(() => {});
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isPostgresSafeText(id)) {
    await request.body?.cancel().catch(() => {});
    return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
  }

  // Resolve the stored claimant before reading the result stream. This lets an
  // oversized submission be terminalized through the same credential-owned,
  // atomic transition as a normal result instead of leaving the task claimed.
  const task = await prisma.agentSearchTask.findFirst({
    where: {
      id,
      organizationId: auth.org.id,
    },
    select: {
      agentId: true,
      searchType: true,
      status: true,
      agent: {
        select: {
          organizationId: true,
          apiTokenId: true,
        },
      },
    },
  });

  if (!task) {
    await request.body?.cancel().catch(() => {});
    return NextResponse.json(
      { error: "Task not found" },
      { status: 404 },
    );
  }

  if (!task.agentId) {
    await request.body?.cancel().catch(() => {});
    return NextResponse.json(
      { error: "Task not in claimed state" },
      { status: 409 },
    );
  }

  if (
    !task.agent ||
    task.agent.organizationId !== auth.org.id ||
    task.agent.apiTokenId !== auth.token.id
  ) {
    await request.body?.cancel().catch(() => {});
    return NextResponse.json(
      { error: "Task is claimed by a different agent" },
      { status: 403 },
    );
  }

  if (TERMINAL_STATUSES.has(task.status)) {
    await request.body?.cancel().catch(() => {});
    return NextResponse.json({ ok: true, status: task.status });
  }

  if (task.status !== "claimed") {
    await request.body?.cancel().catch(() => {});
    return NextResponse.json(
      { error: "Task not in claimed state" },
      { status: 409 },
    );
  }

  const ownershipWhere = ownedClaimedTaskWhere(
    id,
    auth.org.id,
    task.agentId,
    auth.token.id,
  );
  const parsedBody = await readBoundedJson(request, MAX_RESULT_BODY_BYTES);
  if (!parsedBody.ok) {
    if (parsedBody.reason !== "too_large") {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }

    const failed = await prisma.agentSearchTask.updateMany({
      where: ownershipWhere,
      data: {
        status: "failed",
        result: PRISMA_DB_NULL,
        resultSummary: null,
        errorMessage: OVERSIZED_RESULT_ERROR,
        completedAt: new Date(),
      },
    });

    if (failed.count === 0) {
      return terminalRaceResponse(
        id,
        auth.org.id,
        task.agentId,
        auth.token.id,
      );
    }

    publishCompletion(auth.org.id, id, "failed");
    return NextResponse.json(
      { error: OVERSIZED_RESULT_ERROR, status: "failed" },
      { status: 413 },
    );
  }

  const body = parsedBody.value;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { results, resultSummary, errorMessage, agentId } = body as Record<
    string,
    unknown
  >;

  if (agentId !== undefined && (typeof agentId !== "string" || !agentId)) {
    return NextResponse.json(
      { error: "agentId must be a string" },
      { status: 400 },
    );
  }
  if (typeof agentId === "string" && agentId !== task.agentId) {
    return NextResponse.json(
      { error: "Task is claimed by a different agent" },
      { status: 403 },
    );
  }
  if (resultSummary != null && typeof resultSummary !== "string") {
    return NextResponse.json(
      { error: "resultSummary must be a string" },
      { status: 400 },
    );
  }
  if (errorMessage != null && typeof errorMessage !== "string") {
    return NextResponse.json(
      { error: "errorMessage must be a string" },
      { status: 400 },
    );
  }

  // Truncate results if too large — answer tasks get a higher limit
  const summaryLimitCodeUnits =
    task.searchType === "answer"
      ? MAX_ANSWER_SUMMARY_CODE_UNITS
      : MAX_SUMMARY_CODE_UNITS;

  let truncatedResult: Prisma.InputJsonValue;
  try {
    truncatedResult = truncateJsonResult(results);
  } catch {
    return NextResponse.json(
      { error: "results exceed the supported JSON nesting depth" },
      { status: 400 },
    );
  }

  const truncatedSummary =
    typeof resultSummary === "string"
      ? truncateStringSafe(
          sanitizePostgresText(resultSummary),
          summaryLimitCodeUnits,
        )
      : resultSummary;

  const truncatedError =
    typeof errorMessage === "string"
      ? truncateStringSafe(
          sanitizePostgresText(errorMessage),
          MAX_ERROR_CODE_UNITS,
        )
      : errorMessage;
  const status = errorMessage ? "failed" : "completed";

  const updated = await prisma.agentSearchTask.updateMany({
    where: ownershipWhere,
    data: {
      status,
      result: truncatedResult ?? PRISMA_DB_NULL,
      resultSummary: truncatedSummary ?? null,
      errorMessage: truncatedError ?? null,
      completedAt: new Date(),
    },
  });

  if (updated.count === 0) {
    return terminalRaceResponse(
      id,
      auth.org.id,
      task.agentId,
      auth.token.id,
    );
  }

  // Signal completion via Pubby so the chat route can pick up results
  publishCompletion(auth.org.id, id, status);

  return NextResponse.json({ ok: true, status });
}
