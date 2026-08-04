import "server-only";

import { NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { authenticateApiToken } from "@/lib/api-auth";
import {
  isPostgresSafeText,
  readBoundedJson,
  sanitizePostgresText,
  truncateStringSafe,
} from "@/lib/bounded-json";

/**
 * POST /api/agent/llm-tasks/<id>/complete
 *
 * The local agent delivers the LLM result here. Accepts:
 *   - { agentId, text, usage } on success → status="completed"
 *   - { agentId, error }       on failure → status="failed"
 *
 * `agentId` is REQUIRED to match the stored claimant, and the authenticated
 * OrgApiToken must own that LocalAgent record. The token is the security
 * principal: agents intentionally configured with one shared token also share
 * authority and require separate tokens when credential isolation is needed.
 *
 * Idempotent — only flips a task from "claimed" to its terminal state.
 * Subsequent calls on the same task return the current status without
 * mutation.
 */
type CompleteBody = {
  agentId?: string;
  text?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  error?: string;
};

const TERMINAL_STATUSES = new Set(["completed", "failed", "timeout"]);
const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;
const MAX_RESULT_TEXT_BYTES = 2_000_000;
const MAX_ERROR_MESSAGE_CODE_UNITS = 1_000;

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) return value;

  // A UTF-8 code point occupies at most four bytes, so at most three retries
  // are needed when the byte boundary lands inside one.
  for (let end = maxBytes; end > maxBytes - 4 && end > 0; end -= 1) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, end),
      );
    } catch {
      // Try the previous complete code-point boundary.
    }
  }

  return "";
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

  const parsedBody = await readBoundedJson(request, MAX_REQUEST_BODY_BYTES);
  if (!parsedBody.ok) {
    const tooLarge = parsedBody.reason === "too_large";
    return NextResponse.json(
      { error: tooLarge ? "Request body too large" : "Invalid request body" },
      { status: tooLarge ? 413 : 400 },
    );
  }
  if (
    !parsedBody.value ||
    typeof parsedBody.value !== "object" ||
    Array.isArray(parsedBody.value)
  ) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const body = parsedBody.value as CompleteBody;

  if (
    !body.agentId ||
    typeof body.agentId !== "string" ||
    !isPostgresSafeText(body.agentId)
  ) {
    return NextResponse.json(
      { error: "`agentId` is required in the request body" },
      { status: 400 },
    );
  }
  if (body.error !== undefined && typeof body.error !== "string") {
    return NextResponse.json(
      { error: "`error` must be a string" },
      { status: 400 },
    );
  }

  const task = await prisma.agentLlmTask.findFirst({
    where: { id, organizationId: auth.org.id },
    select: {
      agentId: true,
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
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (!task.agentId) {
    return NextResponse.json(
      { error: "Task not in claimed state" },
      { status: 409 },
    );
  }

  // Bind both the stored claimant id and its owning token. A caller cannot
  // borrow an agent id registered by another organization credential.
  if (
    task.agentId !== body.agentId ||
    !task.agent ||
    task.agent.organizationId !== auth.org.id ||
    task.agent.apiTokenId !== auth.token.id
  ) {
    return NextResponse.json(
      { error: "Task is claimed by a different agent" },
      { status: 403 },
    );
  }

  if (task.status !== "claimed") {
    return NextResponse.json({ ok: true, status: task.status }); // idempotent
  }

  const ownershipWhere = {
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
  };

  const currentStatus = () =>
    prisma.agentLlmTask.findFirst({
      where: {
        id,
        organizationId: auth.org.id,
        agentId: task.agentId,
        agent: {
          is: {
            organizationId: auth.org.id,
            apiTokenId: auth.token.id,
          },
        },
      },
      select: { status: true },
    });

  // updateMany with the status guard so a concurrent provider-side timeout
  // doesn't get its terminal state clobbered. The naive `update where: id`
  // form races: poll-loop and /complete can both pass their respective
  // status-checks, then last-write-wins. updateMany returns count=0 if the
  // row has already moved off "claimed", which we treat as idempotent.
  if (body.error) {
    const flipped = await prisma.agentLlmTask.updateMany({
      where: ownershipWhere,
      data: {
        status: "failed",
        errorMessage: truncateStringSafe(
          sanitizePostgresText(body.error),
          MAX_ERROR_MESSAGE_CODE_UNITS,
        ),
        completedAt: new Date(),
      },
    });
    if (flipped.count === 0) {
      // Already terminal from the other side; respond idempotently.
      const current = await currentStatus();
      if (current && TERMINAL_STATUSES.has(current.status)) {
        return NextResponse.json({ ok: true, status: current.status });
      }
      return NextResponse.json(
        { error: "Task result could not be recorded" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, status: "failed" });
  }

  if (typeof body.text !== "string") {
    return NextResponse.json(
      { error: "Either `text` or `error` is required" },
      { status: 400 },
    );
  }

  // Cap result size + sanity-check usage before storing. resultText flows
  // through to AiResponse.text and into the review pipeline; a multi-MB
  // text from a buggy agent (or a buggy model output that exceeded the
  // schema cap) would otherwise bloat the DB indefinitely. usage is
  // typed-narrowed so non-number values can't poison the int columns
  // logAiUsage writes downstream.
  const cappedText = truncateUtf8(
    sanitizePostgresText(body.text),
    MAX_RESULT_TEXT_BYTES,
  );
  const usage = body.usage as Record<string, unknown> | null | undefined;
  const sanitizedUsage = usage
    ? {
        inputTokens:
          typeof usage.inputTokens === "number" &&
          Number.isFinite(usage.inputTokens)
            ? usage.inputTokens
            : 0,
        outputTokens:
          typeof usage.outputTokens === "number" &&
          Number.isFinite(usage.outputTokens)
            ? usage.outputTokens
            : 0,
        cacheReadTokens:
          typeof usage.cacheReadTokens === "number" &&
          Number.isFinite(usage.cacheReadTokens)
            ? usage.cacheReadTokens
            : 0,
        cacheWriteTokens:
          typeof usage.cacheWriteTokens === "number" &&
          Number.isFinite(usage.cacheWriteTokens)
            ? usage.cacheWriteTokens
            : 0,
      }
    : undefined;

  const flipped = await prisma.agentLlmTask.updateMany({
    where: ownershipWhere,
    data: {
      status: "completed",
      resultText: cappedText,
      resultUsage: sanitizedUsage,
      completedAt: new Date(),
    },
  });
  if (flipped.count === 0) {
    const current = await currentStatus();
    if (current && TERMINAL_STATUSES.has(current.status)) {
      return NextResponse.json({ ok: true, status: current.status });
    }
    return NextResponse.json(
      { error: "Task result could not be recorded" },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, status: "completed" });
}
