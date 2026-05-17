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

  if (body.error) {
    await prisma.agentLlmTask.update({
      where: { id },
      data: {
        status: "failed",
        errorMessage: body.error.slice(0, 1000),
        completedAt: new Date(),
      },
    });
    return NextResponse.json({ ok: true, status: "failed" });
  }

  if (typeof body.text !== "string") {
    return NextResponse.json(
      { error: "Either `text` or `error` is required" },
      { status: 400 },
    );
  }

  await prisma.agentLlmTask.update({
    where: { id },
    data: {
      status: "completed",
      resultText: body.text,
      resultUsage: body.usage ?? undefined,
      completedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true, status: "completed" });
}
