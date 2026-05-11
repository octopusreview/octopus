import { prisma } from "@octopus/db";
import { eventBus } from "../bus";
import { decryptStringMaybeLegacy } from "@/lib/crypto";
import type {
  RepoIndexedEvent,
  RepoAnalyzedEvent,
  ReviewRequestedEvent,
  ReviewCompletedEvent,
  ReviewFailedEvent,
  KnowledgeReadyEvent,
} from "../types";

async function sendSlackMessage(
  orgId: string,
  eventType: string,
  message: string,
): Promise<void> {
  const integration = await prisma.slackIntegration.findUnique({
    where: { organizationId: orgId },
    include: { eventConfigs: true },
  });

  if (!integration || !integration.channelId) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[slack-observer] No integration or channelId for org ${orgId}`);
    }
    return;
  }

  const config = integration.eventConfigs.find(
    (c) => c.eventType === eventType,
  );
  if (config && !config.enabled) return;

  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${decryptStringMaybeLegacy(integration.accessToken)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: integration.channelId,
        text: message,
        unfurl_links: false,
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      console.error(`[slack-observer] Failed to post message: ${data.error}`);
    } else if (process.env.NODE_ENV !== "production") {
      console.log(`[slack-observer] Message sent to ${integration.channelName} for ${eventType}`);
    }
  } catch (err) {
    console.error("[slack-observer] Error sending Slack notification:", err);
  }
}

function formatRepoIndexed(event: RepoIndexedEvent): string {
  if (event.success) {
    const parts = [`📦 *Repository Indexed* — ${event.repoFullName}`];
    if (event.indexedFiles != null && event.totalVectors != null) {
      const suffix = event.durationMs != null
        ? ` (${Math.round(event.durationMs / 1000)}s)`
        : "";
      parts.push(`${event.indexedFiles} files, ${event.totalVectors} vectors${suffix}`);
    }
    return parts.join("\n");
  }
  return `❌ *${event.repoFullName}* indexing failed: ${event.error ?? "Unknown error"}`;
}

function formatRepoAnalyzed(event: RepoAnalyzedEvent): string {
  return `🔬 *Repository Analyzed* — ${event.repoFullName}`;
}

function formatReviewRequested(event: ReviewRequestedEvent): string {
  return `🐙 *Review Requested* — PR #${event.prNumber}: ${event.prTitle}\nAuthor: ${event.prAuthor}\n${event.prUrl}`;
}

function formatReviewCompleted(event: ReviewCompletedEvent): string {
  const findings = `${event.findingsCount} finding${event.findingsCount !== 1 ? "s" : ""}`;
  const files = `${event.filesChanged} file${event.filesChanged !== 1 ? "s" : ""} reviewed`;
  return `✅ *Review Completed* — PR #${event.prNumber}: ${event.prTitle}\n${findings}, ${files}\n${event.prUrl}`;
}

function formatReviewFailed(event: ReviewFailedEvent): string {
  return `❌ *Review Failed* — PR #${event.prNumber}: ${event.prTitle}\nError: ${event.error}`;
}

function formatKnowledgeReady(event: KnowledgeReadyEvent): string {
  const actionLabel =
    event.action === "created" ? "Ready" :
    event.action === "updated" ? "Updated" :
    "Restored";
  return `📚 *Knowledge Document ${actionLabel}* — "${event.documentTitle}"\n${event.totalChunks} chunks, ${event.totalVectors} vectors`;
}

export function registerSlackObserver(): void {
  console.log("[slack-observer] Registering Slack observer");

  eventBus.on<RepoIndexedEvent>("repo-indexed", (event) =>
    sendSlackMessage(event.orgId, "repo-indexed", formatRepoIndexed(event)),
  );

  eventBus.on<RepoAnalyzedEvent>("repo-analyzed", (event) =>
    sendSlackMessage(event.orgId, "repo-analyzed", formatRepoAnalyzed(event)),
  );

  eventBus.on<ReviewRequestedEvent>("review-requested", (event) =>
    sendSlackMessage(event.orgId, "review-requested", formatReviewRequested(event)),
  );

  eventBus.on<ReviewCompletedEvent>("review-completed", (event) =>
    sendSlackMessage(event.orgId, "review-completed", formatReviewCompleted(event)),
  );

  eventBus.on<ReviewFailedEvent>("review-failed", (event) =>
    sendSlackMessage(event.orgId, "review-failed", formatReviewFailed(event)),
  );

  eventBus.on<KnowledgeReadyEvent>("knowledge-ready", (event) =>
    sendSlackMessage(event.orgId, "knowledge-ready", formatKnowledgeReady(event)),
  );
}
