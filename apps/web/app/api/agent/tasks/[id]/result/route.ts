import "server-only";

import { NextResponse } from "next/server";
import { prisma, type Prisma } from "@octopus/db";
import { authenticateApiToken } from "@/lib/api-auth";
import { readBoundedJson, truncateStringSafe } from "@/lib/bounded-json";
import { pubby } from "@/lib/pubby";

const MAX_RESULT_BODY_SIZE = 1024 * 1024; // 1MB
const MAX_RESULT_SIZE = 50 * 1024; // 50KB
const MAX_SUMMARY_SIZE = 15 * 1024; // 15KB
const MAX_ANSWER_SUMMARY_SIZE = 100 * 1024; // 100KB for answer tasks
const MAX_ERROR_SIZE = 1_000;
const TERMINAL_STATUSES = new Set(["completed", "failed", "timeout"]);

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function truncateJsonResult(value: unknown): Prisma.InputJsonValue {
  const normalized = value ?? null;
  const serialized = JSON.stringify(normalized) ?? "null";
  const originalSizeBytes = new TextEncoder().encode(serialized).byteLength;

  if (originalSizeBytes <= MAX_RESULT_SIZE) {
    return normalized as Prisma.InputJsonValue;
  }

  const envelope = (preview: string) => ({
    truncated: true,
    originalSizeBytes,
    preview,
  });

  // Keep the stored value valid JSON. Slicing serialized JSON and parsing it
  // can split an object, string, escape sequence, or multibyte character.
  // Binary-search the largest preview whose complete envelope stays bounded.
  let low = 0;
  let high = serialized.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    if (
      jsonByteLength(envelope(serialized.slice(0, midpoint))) <= MAX_RESULT_SIZE
    ) {
      low = midpoint;
    } else {
      high = midpoint - 1;
    }
  }

  return envelope(truncateStringSafe(serialized, low));
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
  const parsedBody = await readBoundedJson(request, MAX_RESULT_BODY_SIZE);
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

  // Bind result delivery to the credential that registered the stored
  // claimant. agentId remains optional for backwards-compatible clients, but
  // when present it must name that same claimant.
  const task = await prisma.agentSearchTask.findFirst({
    where: {
      id,
      organizationId: auth.org.id,
      status: "claimed",
    },
    select: {
      agentId: true,
      searchType: true,
      agent: {
        select: {
          organizationId: true,
          apiTokenId: true,
        },
      },
    },
  });

  if (!task) {
    return NextResponse.json(
      { error: "Task not found or not in claimed state" },
      { status: 404 },
    );
  }

  if (
    !task.agentId ||
    !task.agent ||
    task.agent.organizationId !== auth.org.id ||
    task.agent.apiTokenId !== auth.token.id ||
    (typeof agentId === "string" && agentId !== task.agentId)
  ) {
    return NextResponse.json(
      { error: "Task is claimed by a different agent" },
      { status: 403 },
    );
  }

  // Truncate results if too large — answer tasks get a higher limit
  const summaryLimit =
    task.searchType === "answer" ? MAX_ANSWER_SUMMARY_SIZE : MAX_SUMMARY_SIZE;

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
      ? truncateStringSafe(resultSummary, summaryLimit)
      : resultSummary;

  const truncatedError =
    typeof errorMessage === "string"
      ? truncateStringSafe(errorMessage, MAX_ERROR_SIZE)
      : errorMessage;
  const status = errorMessage ? "failed" : "completed";

  const updated = await prisma.agentSearchTask.updateMany({
    where: {
      id,
      organizationId: auth.org.id,
      agentId: task.agentId,
      status: "claimed",
      agent: {
        is: {
          organizationId: auth.org.id,
          apiTokenId: auth.token.id,
        },
      },
    },
    data: {
      status,
      result: truncatedResult ?? null,
      resultSummary: truncatedSummary ?? null,
      errorMessage: truncatedError ?? null,
      completedAt: new Date(),
    },
  });

  if (updated.count === 0) {
    const current = await prisma.agentSearchTask.findFirst({
      where: {
        id,
        organizationId: auth.org.id,
        agentId: task.agentId,
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

  // Signal completion via Pubby so the chat route can pick up results
  pubby
    .trigger(`private-agent-org-${auth.org.id}`, "agent-search-complete", {
      taskId: id,
      status,
    })
    .catch(() => {});

  return NextResponse.json({ ok: true, status });
}
