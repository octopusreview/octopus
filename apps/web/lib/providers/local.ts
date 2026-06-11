import "server-only";
import { prisma } from "@octopus/db";
import type { Provider, AiCreateParams, AiResponse } from "./index";
import { AGENT_STALE_THRESHOLD_MS } from "@/lib/agent-constants";

/**
 * Local-agent bridge provider. Dispatches the LLM call to a developer's
 * laptop (running `octp agent serve`) instead of calling a provider API
 * directly. Lets cloud Octopus route reviews through a local Ollama, a
 * subscription-mode Claude Code CLI, or anything else the agent can run.
 *
 * Model ID convention: `local:<actual-model-id>`. The local agent
 * receives the full id and decides how to handle it (typically by
 * delegating to its own local provider router).
 *
 * Cloud caveat: at least one online agent must be registered for the
 * organisation. If no agent is online, this provider times out and
 * surfaces "no agent available" so the user knows to start `octp agent
 * serve`.
 */

const POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Staleness threshold lives in @/lib/agent-constants so this fail-fast
// check, /api/agent/status, the settings page, and agent-search.ts all
// agree on the same window. Without the shared constant, a drift in any
// one of them would have a crashed agent considered online on one
// surface but offline on another.

export const localProvider: Provider = {
  name: "local" as never,
  supportsJsonSchema: false, // depends on the agent's underlying provider; advertise conservatively
  async create(
    params: AiCreateParams,
    _apiKey?: string | null,
    orgId?: string | null,
  ): Promise<AiResponse> {
    if (!orgId) {
      throw new Error(
        "local provider needs an organisation context. Caller must pass orgId to provider.create().",
      );
    }

    // Sanity-check at least one agent is online so we fail fast instead of
    // polling for the full timeout while the user has no agent running.
    // `status: "online"` alone is insufficient — that column is only written
    // by the heartbeat endpoint, so a crashed agent stays "online" forever
    // and this check passes. The 90s lastSeenAt window matches the same
    // check applied in /api/agent/status and the settings page.
    const onlineAgents = await prisma.localAgent.count({
      where: {
        organizationId: orgId,
        status: "online",
        lastSeenAt: { gte: new Date(Date.now() - AGENT_STALE_THRESHOLD_MS) },
      },
    });
    if (onlineAgents === 0) {
      throw new Error(
        "No local agent is online for this organisation. Run `octp agent serve` on a machine with the API token.",
      );
    }

    const task = await prisma.agentLlmTask.create({
      data: {
        organizationId: orgId,
        modelId: params.model.startsWith("local:") ? params.model.slice(6) : params.model,
        system: params.system,
        messages: params.messages as object,
        maxTokens: params.maxTokens,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      },
      select: { id: true },
    });

    const result = await pollUntilTerminal(task.id, DEFAULT_TIMEOUT_MS);
    if (result.status === "failed") {
      throw new Error(`local agent failed: ${result.errorMessage ?? "unknown error"}`);
    }
    if (result.status === "timeout") {
      throw new Error(
        `local agent timed out after ${Math.round(DEFAULT_TIMEOUT_MS / 1000)}s. ` +
          "Is the agent online and responsive?",
      );
    }

    const usage = (result.resultUsage as Record<string, number> | null) ?? {};
    return {
      text: result.resultText ?? "",
      provider: "local" as never,
      model: params.model,
      usage: {
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheReadTokens: usage.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.cacheWriteTokens ?? 0,
      },
    };
  },
};

async function pollUntilTerminal(taskId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await prisma.agentLlmTask.findUnique({
      where: { id: taskId },
      select: { status: true, resultText: true, resultUsage: true, errorMessage: true },
    });
    if (!row) throw new Error("Task vanished");
    if (row.status === "completed" || row.status === "failed") return row;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  // Mark as timeout — guarded so a concurrent /complete that lands during
  // the final sleep doesn't get its terminal state clobbered. updateMany
  // with a status condition is atomic; count===0 means the agent finished
  // first, so re-read and return whatever it wrote.
  const flipped = await prisma.agentLlmTask.updateMany({
    where: { id: taskId, status: { in: ["pending", "claimed"] } },
    data: { status: "timeout", completedAt: new Date() },
  });
  if (flipped.count === 0) {
    const row = await prisma.agentLlmTask.findUnique({
      where: { id: taskId },
      select: { status: true, resultText: true, resultUsage: true, errorMessage: true },
    });
    if (row && (row.status === "completed" || row.status === "failed")) {
      return row;
    }
  }
  return {
    status: "timeout" as const,
    resultText: null,
    resultUsage: null,
    errorMessage: `Polling timed out after ${timeoutMs}ms`,
  };
}

