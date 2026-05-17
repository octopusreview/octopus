import { NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { authenticateApiToken } from "@/lib/api-auth";

/**
 * POST /api/agent/llm-tasks/<id>/complete
 *
 * The local agent delivers the LLM result here. Accepts:
 *   - { text, usage } on success → status="completed"
 *   - { error } on failure        → status="failed"
 *
 * Idempotent — only flips a task from "claimed" to its terminal state.
 * Subsequent calls on the same task are no-ops.
 */
type CompleteBody = {
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

  const task = await prisma.agentLlmTask.findFirst({
    where: { id, organizationId: auth.org.id },
  });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
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
