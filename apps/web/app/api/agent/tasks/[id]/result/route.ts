import { NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { authenticateApiToken } from "@/lib/api-auth";
import { pubby } from "@/lib/pubby";

const MAX_RESULT_SIZE = 50 * 1024; // 50KB
const MAX_SUMMARY_SIZE = 15 * 1024; // 15KB

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { results, resultSummary, errorMessage } = body;

  // Verify task belongs to this org and is claimed
  const task = await prisma.agentSearchTask.findFirst({
    where: {
      id,
      organizationId: auth.org.id,
      status: "claimed",
    },
  });

  if (!task) {
    return NextResponse.json(
      { error: "Task not found or not in claimed state" },
      { status: 404 },
    );
  }

  // Truncate results if too large
  const resultStr = JSON.stringify(results ?? null);
  const truncatedResult =
    resultStr.length > MAX_RESULT_SIZE
      ? JSON.parse(resultStr.slice(0, MAX_RESULT_SIZE))
      : results;

  const truncatedSummary =
    resultSummary && resultSummary.length > MAX_SUMMARY_SIZE
      ? resultSummary.slice(0, MAX_SUMMARY_SIZE)
      : resultSummary;

  const status = errorMessage ? "failed" : "completed";

  await prisma.agentSearchTask.update({
    where: { id },
    data: {
      status,
      result: truncatedResult ?? null,
      resultSummary: truncatedSummary ?? null,
      errorMessage: errorMessage ?? null,
      completedAt: new Date(),
    },
  });

  // Signal completion via Pubby so the chat route can pick up results
  pubby
    .trigger(`private-agent-org-${auth.org.id}`, "agent-search-complete", {
      taskId: id,
      status,
    })
    .catch(() => {});

  return NextResponse.json({ ok: true });
}
