import { prisma } from "@octopus/db";
import { pubby } from "@/lib/pubby";

const STALE_THRESHOLD_MS = 90_000; // 90s
const POLL_INTERVAL_MS = 500;

interface AgentSearchOptions {
  orgId: string;
  query: string;
  conversationId?: string;
  timeoutMs?: number;
}

interface AgentSearchResult {
  summary: string;
  taskId: string;
  agentName: string | null;
}

/**
 * Request a local agent to search a codebase.
 * Finds any online agent for the org and dispatches the query.
 * Returns the result summary if an agent completes in time, null otherwise.
 */
export async function requestAgentSearch(
  options: AgentSearchOptions,
): Promise<AgentSearchResult | null> {
  const { orgId, query, conversationId } = options;

  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);

  // Find any online agent for this org
  const onlineAgent = await prisma.localAgent.findFirst({
    where: {
      organizationId: orgId,
      status: "online",
      lastSeenAt: { gte: staleThreshold },
    },
    select: {
      id: true,
      name: true,
      repoFullNames: true,
      capabilities: true,
    },
  });

  if (!onlineAgent) return null;

  const agentRepos = onlineAgent.repoFullNames as string[];
  if (agentRepos.length === 0) return null;

  // Use the first repo the agent watches as target
  const targetRepo = agentRepos[0];

  // Determine search type and timeout
  const caps = onlineAgent.capabilities as string[];
  const hasClaudeCli = caps.includes("claude-cli");
  const searchType = hasClaudeCli ? "claude" : "semantic";
  const timeoutMs =
    options.timeoutMs ?? (searchType === "claude" ? 30_000 : 10_000);

  // Create the search task
  const task = await prisma.agentSearchTask.create({
    data: {
      query,
      searchType,
      status: "pending",
      repoFullName: targetRepo,
      organizationId: orgId,
      conversationId: conversationId ?? null,
      timeoutMs,
    },
  });

  console.log(`[agent-search] Created task ${task.id} for "${query.slice(0, 50)}" → agent "${onlineAgent.name}" repo "${targetRepo}"`);

  // Signal agents via Pubby
  pubby
    .trigger(`private-agent-org-${orgId}`, "agent-search-request", {
      taskId: task.id,
      query,
      repoFullName: targetRepo,
      searchType,
    })
    .catch(() => {});

  // Poll for completion
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const updated = await prisma.agentSearchTask.findUnique({
      where: { id: task.id },
      select: {
        status: true,
        resultSummary: true,
        agent: { select: { name: true } },
      },
    });

    if (!updated) break;

    if (updated.status === "completed" && updated.resultSummary) {
      return {
        summary: updated.resultSummary,
        taskId: task.id,
        agentName: updated.agent?.name ?? null,
      };
    }

    if (updated.status === "failed") {
      return null;
    }
  }

  // Timeout
  console.log(`[agent-search] Task ${task.id} timed out after ${timeoutMs}ms`);
  await prisma.agentSearchTask
    .updateMany({
      where: { id: task.id, status: { in: ["pending", "claimed"] } },
      data: { status: "timeout", completedAt: new Date() },
    })
    .catch(() => {});

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
