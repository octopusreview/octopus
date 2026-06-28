import { NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { authenticateApiToken } from "@/lib/api-auth";

/**
 * POST /api/agent/llm-tasks/<id>/complete
 *
 * The local agent delivers the LLM result here. Accepts:
 *   - { agentId, text, usage } on success → status="completed"
 *   - { agentId, error }       on failure → status="failed"
 *
 * `agentId` is REQUIRED so we can verify the caller is the agent that
 * actually claimed the task. Without this check, any holder of an
 * OrgApiToken in the same org could overwrite results posted by another
 * agent on the same machine — the claim endpoint pins task.agentId, but
 * the API token doesn't identify which agent within the org is calling.
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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as CompleteBody;

  if (!body.agentId || typeof body.agentId !== "string") {
    return NextResponse.json(
      { error: "`agentId` is required in the request body" },
      { status: 400 },
    );
  }

  const task = await prisma.agentLlmTask.findFirst({
    where: { id, organizationId: auth.org.id },
  });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Ownership check — the agent posting the result MUST be the agent that
  // claimed the task. Otherwise a co-resident agent (same org, same token)
  // could overwrite another agent's in-flight result.
  if (task.agentId && task.agentId !== body.agentId) {
    return NextResponse.json(
      { error: "Task is claimed by a different agent" },
      { status: 403 },
    );
  }

  if (task.status !== "claimed") {
    return NextResponse.json({ ok: true, status: task.status }); // idempotent
  }

  // updateMany with the status guard so a concurrent provider-side timeout
  // doesn't get its terminal state clobbered. The naive `update where: id`
  // form races: poll-loop and /complete can both pass their respective
  // status-checks, then last-write-wins. updateMany returns count=0 if the
  // row has already moved off "claimed", which we treat as idempotent.
  if (body.error) {
    const flipped = await prisma.agentLlmTask.updateMany({
      where: { id, status: "claimed" },
      data: {
        status: "failed",
        errorMessage: body.error.slice(0, 1000),
        completedAt: new Date(),
      },
    });
    if (flipped.count === 0) {
      // Already terminal from the other side; respond idempotently.
      const current = await prisma.agentLlmTask.findUnique({
        where: { id },
        select: { status: true },
      });
      return NextResponse.json({ ok: true, status: current?.status ?? "failed" });
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
  const MAX_RESULT_TEXT_BYTES = 2_000_000;
  const cappedText =
    body.text.length > MAX_RESULT_TEXT_BYTES
      ? body.text.slice(0, MAX_RESULT_TEXT_BYTES)
      : body.text;
  const usage = body.usage as Record<string, unknown> | null | undefined;
  const sanitizedUsage = usage
    ? {
        inputTokens: typeof usage.inputTokens === "number" && Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0,
        outputTokens: typeof usage.outputTokens === "number" && Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0,
        cacheReadTokens: typeof usage.cacheReadTokens === "number" && Number.isFinite(usage.cacheReadTokens) ? usage.cacheReadTokens : 0,
        cacheWriteTokens: typeof usage.cacheWriteTokens === "number" && Number.isFinite(usage.cacheWriteTokens) ? usage.cacheWriteTokens : 0,
      }
    : undefined;

  const flipped = await prisma.agentLlmTask.updateMany({
    where: { id, status: "claimed" },
    data: {
      status: "completed",
      resultText: cappedText,
      resultUsage: sanitizedUsage,
      completedAt: new Date(),
    },
  });
  if (flipped.count === 0) {
    const current = await prisma.agentLlmTask.findUnique({
      where: { id },
      select: { status: true },
    });
    return NextResponse.json({ ok: true, status: current?.status ?? "completed" });
  }

  return NextResponse.json({ ok: true, status: "completed" });
}
