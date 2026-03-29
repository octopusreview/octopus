import { prisma } from "@octopus/db";
import { sendEmail } from "@/lib/email";
import { escapeHtml, sanitizeUrl } from "@/lib/html";
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
      // Default is enabled (no preference row = enabled)
      const pref = m.emailNotificationPreferences[0];
      return pref ? pref.enabled : true;
    })
    .map((m) => ({ email: m.user.email, name: m.user.name }));
}

function wrapHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">
  <div style="border-bottom: 2px solid #f0f0f0; padding-bottom: 16px; margin-bottom: 20px;">
    <strong style="font-size: 16px;">Octopus</strong>
  </div>
  <h2 style="font-size: 18px; margin: 0 0 12px;">${title}</h2>
  ${body}
  <div style="border-top: 1px solid #f0f0f0; margin-top: 24px; padding-top: 12px; font-size: 12px; color: #888;">
    You can manage your email notification preferences in <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "https://octopus-review.ai"}/settings/notifications" style="color: #666;">Settings</a>.
  </div>
</body>
</html>`;
}

async function sendEventEmail(
  orgId: string,
  eventType: string,
  subject: string,
  title: string,
  body: string,
): Promise<void> {
  const recipients = await getEligibleRecipients(orgId, eventType);
  if (recipients.length === 0) return;

  const html = wrapHtml(title, body);

  await Promise.allSettled(
    recipients.map((r) =>
      sendEmail({ to: r.email, subject, html }).catch((err) =>
        console.error(`[email-observer] Failed to send to ${r.email}:`, err),
      ),
    ),
  );
}

function onRepoIndexed(event: RepoIndexedEvent): Promise<void> {
  const repo = escapeHtml(event.repoFullName);
  if (event.success) {
    const details = event.indexedFiles != null
      ? `<p style="color: #555;">${event.indexedFiles} files indexed, ${event.totalVectors ?? 0} vectors created${event.durationMs != null ? ` in ${Math.round(event.durationMs / 1000)}s` : ""}</p>`
      : "";
    return sendEventEmail(
      event.orgId,
      "repo-indexed",
      `Repository Indexed: ${repo}`,
      `Repository Indexed`,
      `<p><strong>${repo}</strong> has been successfully indexed.</p>${details}`,
    );
  }
  const error = escapeHtml(event.error ?? "Unknown error");
  return sendEventEmail(
    event.orgId,
    "repo-indexed",
    `Repository Indexing Failed: ${repo}`,
    `Repository Indexing Failed`,
    `<p><strong>${repo}</strong> indexing failed.</p><p style="color: #c00;">${error}</p>`,
  );
}

function onRepoAnalyzed(event: RepoAnalyzedEvent): Promise<void> {
  const repo = escapeHtml(event.repoFullName);
  return sendEventEmail(
    event.orgId,
    "repo-analyzed",
    `Repository Analyzed: ${repo}`,
    `Repository Analyzed`,
    `<p><strong>${repo}</strong> analysis is complete.</p>`,
  );
}

function onReviewRequested(event: ReviewRequestedEvent): Promise<void> {
  const title = escapeHtml(event.prTitle);
  const author = escapeHtml(event.prAuthor);
  return sendEventEmail(
    event.orgId,
    "review-requested",
    `Review Requested: PR #${event.prNumber} ${title}`,
    `Review Requested`,
    `<p>PR <a href="${escapeHtml(sanitizeUrl(event.prUrl))}" style="color: #0366d6;">#${event.prNumber}: ${title}</a></p><p style="color: #555;">Author: ${author}</p>`,
  );
}

function onReviewCompleted(event: ReviewCompletedEvent): Promise<void> {
  const title = escapeHtml(event.prTitle);
  const findings = `${event.findingsCount} finding${event.findingsCount !== 1 ? "s" : ""}`;
  const files = `${event.filesChanged} file${event.filesChanged !== 1 ? "s" : ""} reviewed`;
  return sendEventEmail(
    event.orgId,
    "review-completed",
    `Review Completed: PR #${event.prNumber} ${title}`,
    `Review Completed`,
    `<p>PR <a href="${escapeHtml(sanitizeUrl(event.prUrl))}" style="color: #0366d6;">#${event.prNumber}: ${title}</a></p><p style="color: #555;">${findings}, ${files}</p>`,
  );
}

function onReviewFailed(event: ReviewFailedEvent): Promise<void> {
  const title = escapeHtml(event.prTitle);
  const error = escapeHtml(event.error);
  return sendEventEmail(
    event.orgId,
    "review-failed",
    `Review Failed: PR #${event.prNumber} ${title}`,
    `Review Failed`,
    `<p>PR #${event.prNumber}: <strong>${title}</strong></p><p style="color: #c00;">Error: ${error}</p>`,
  );
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

  const balanceFormatted = `$${event.remainingBalance.toFixed(2)}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://octopus-review.ai";

  const subject = `Credit Balance Low — ${balanceFormatted} remaining`;
  const html = wrapHtml(
    "Credit Balance Low",
    `<p>Your organization's credit balance has dropped to <strong>${balanceFormatted}</strong>.</p>
     <p style="color: #555;">When credits run out, PR reviews and other AI-powered features will stop working.</p>
     <p><a href="${appUrl}/settings/billing" style="display: inline-block; padding: 10px 20px; background: #0366d6; color: #fff; text-decoration: none; border-radius: 6px;">Add Credits</a></p>`,
  );

  await Promise.allSettled(
    recipients.map((r) =>
      sendEmail({ to: r.email, subject, html }).catch((err) =>
        console.error(`[email-observer] Failed to send credit-low to ${r.email}:`, err),
      ),
    ),
  );
}

function onKnowledgeReady(event: KnowledgeReadyEvent): Promise<void> {
  const actionLabel =
    event.action === "created" ? "Ready" :
    event.action === "updated" ? "Updated" :
    "Restored";
  const docTitle = escapeHtml(event.documentTitle);
  return sendEventEmail(
    event.orgId,
    "knowledge-ready",
    `Knowledge Document ${actionLabel}: ${docTitle}`,
    `Knowledge Document ${actionLabel}`,
    `<p>"<strong>${docTitle}</strong>" is now available.</p><p style="color: #555;">${event.totalChunks} chunks, ${event.totalVectors} vectors</p>`,
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
