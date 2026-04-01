import { prisma } from "@octopus/db";
import { sendEmail } from "@/lib/email";
import { escapeHtml, sanitizeUrl } from "@/lib/html";
import { renderEmailTemplate } from "@/lib/email-renderer";
import { eventBus } from "../bus";
import type {
  RepoIndexedEvent,
  RepoAnalyzedEvent,
  ReviewRequestedEvent,
  ReviewCompletedEvent,
  ReviewFailedEvent,
  KnowledgeReadyEvent,
  CreditLowEvent,
} from "../types";

async function getEligibleRecipients(
  orgId: string,
  eventType: string,
): Promise<{ email: string; name: string }[]> {
  const members = await prisma.organizationMember.findMany({
    where: {
      organizationId: orgId,
      deletedAt: null,
    },
    select: {
      user: { select: { email: true, name: true } },
      emailNotificationPreferences: {
        where: { eventType },
        select: { enabled: true },
      },
    },
  });

  return members
    .filter((m) => {
      const pref = m.emailNotificationPreferences[0];
      return pref ? pref.enabled : false;
    })
    .map((m) => ({ email: m.user.email, name: m.user.name }));
}

async function sendTemplatedEventEmail(
  orgId: string,
  eventType: string,
  slug: string,
  variables: Record<string, string>,
): Promise<void> {
  const recipients = await getEligibleRecipients(orgId, eventType);
  if (recipients.length === 0) return;

  const result = await renderEmailTemplate(slug, variables);
  if (!result) return;

  await Promise.allSettled(
    recipients.map((r) =>
      sendEmail({ to: r.email, subject: result.subject, html: result.html }).catch((err) =>
        console.error(`[email-observer] Failed to send to ${r.email}:`, err),
      ),
    ),
  );
}

function onRepoIndexed(event: RepoIndexedEvent): Promise<void> {
  const repo = escapeHtml(event.repoFullName);
  if (event.success) {
    const details =
      event.indexedFiles != null
        ? `${event.indexedFiles} files indexed, ${event.totalVectors ?? 0} vectors created${event.durationMs != null ? ` in ${Math.round(event.durationMs / 1000)}s` : ""}`
        : "";
    return sendTemplatedEventEmail(event.orgId, "repo-indexed", "repo-indexed", {
      repoFullName: repo,
      details,
    });
  }
  return sendTemplatedEventEmail(event.orgId, "repo-indexed", "repo-index-failed", {
    repoFullName: repo,
    error: escapeHtml(event.error ?? "Unknown error"),
  });
}

function onRepoAnalyzed(event: RepoAnalyzedEvent): Promise<void> {
  return sendTemplatedEventEmail(event.orgId, "repo-analyzed", "repo-analyzed", {
    repoFullName: escapeHtml(event.repoFullName),
  });
}

function onReviewRequested(event: ReviewRequestedEvent): Promise<void> {
  return sendTemplatedEventEmail(event.orgId, "review-requested", "review-requested", {
    prNumber: String(event.prNumber),
    prTitle: escapeHtml(event.prTitle),
    prAuthor: escapeHtml(event.prAuthor),
    prUrl: escapeHtml(sanitizeUrl(event.prUrl)),
  });
}

function onReviewCompleted(event: ReviewCompletedEvent): Promise<void> {
  return sendTemplatedEventEmail(event.orgId, "review-completed", "review-completed", {
    prNumber: String(event.prNumber),
    prTitle: escapeHtml(event.prTitle),
    prUrl: escapeHtml(sanitizeUrl(event.prUrl)),
    findingsCount: String(event.findingsCount),
    filesChanged: String(event.filesChanged),
  });
}

function onReviewFailed(event: ReviewFailedEvent): Promise<void> {
  return sendTemplatedEventEmail(event.orgId, "review-failed", "review-failed", {
    prNumber: String(event.prNumber),
    prTitle: escapeHtml(event.prTitle),
    error: escapeHtml(event.error),
  });
}

function onKnowledgeReady(event: KnowledgeReadyEvent): Promise<void> {
  const actionLabel =
    event.action === "created"
      ? "Ready"
      : event.action === "updated"
        ? "Updated"
        : "Restored";
  return sendTemplatedEventEmail(event.orgId, "knowledge-ready", "knowledge-ready", {
    documentTitle: escapeHtml(event.documentTitle),
    actionLabel,
    totalChunks: String(event.totalChunks),
    totalVectors: String(event.totalVectors),
  });
}

async function getAdminRecipients(
  orgId: string,
): Promise<{ email: string; name: string }[]> {
  const members = await prisma.organizationMember.findMany({
    where: {
      organizationId: orgId,
      deletedAt: null,
      role: { in: ["owner", "admin"] },
    },
    select: {
      user: { select: { email: true, name: true } },
    },
  });

  return members
    .filter((m) => m.user.email)
    .map((m) => ({ email: m.user.email, name: m.user.name }));
}

// Track last credit-low email per org to avoid spamming (24h cooldown)
const creditLowLastSent = new Map<string, number>();

async function onCreditLow(event: CreditLowEvent): Promise<void> {
  const now = Date.now();
  const lastSent = creditLowLastSent.get(event.orgId);

  if (lastSent && now - lastSent < 24 * 60 * 60 * 1000) return;

  const recipients = await getAdminRecipients(event.orgId);
  if (recipients.length === 0) return;

  creditLowLastSent.set(event.orgId, now);

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://octopus-review.ai";

  const result = await renderEmailTemplate("credit-low", {
    balance: `$${event.remainingBalance.toFixed(2)}`,
    appUrl,
  });

  if (!result) return;

  await Promise.allSettled(
    recipients.map((r) =>
      sendEmail({ to: r.email, subject: result.subject, html: result.html }).catch((err) =>
        console.error(`[email-observer] Failed to send credit-low to ${r.email}:`, err),
      ),
    ),
  );
}

export function registerEmailObserver(): void {
  console.log("[email-observer] Registering Email observer");

  eventBus.on<RepoIndexedEvent>("repo-indexed", onRepoIndexed);
  eventBus.on<RepoAnalyzedEvent>("repo-analyzed", onRepoAnalyzed);
  eventBus.on<ReviewRequestedEvent>("review-requested", onReviewRequested);
  eventBus.on<ReviewCompletedEvent>("review-completed", onReviewCompleted);
  eventBus.on<ReviewFailedEvent>("review-failed", onReviewFailed);
  eventBus.on<KnowledgeReadyEvent>("knowledge-ready", onKnowledgeReady);
  eventBus.on<CreditLowEvent>("credit-low", onCreditLow);
}
