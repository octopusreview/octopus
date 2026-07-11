import { prisma } from "@octopus/db";
import { sendEmail } from "./email";
import { escapeHtml } from "./html";
import { renderEmailTemplate } from "./email-renderer";
import { addFreeCredits } from "./credits";
import { writeAuditLog } from "./audit";
import { getAdminRecipients } from "./org-recipients";

/**
 * Incident comms engine — powers the /api/admin/incidents/* endpoints behind
 * `octp admin incidents`. Finds orgs whose reviews failed inside a time
 * window, emails their owner/admin members from a DB template, and optionally
 * grants goodwill free credits. Idempotent per (incidentKey, org) via the
 * IncidentComm unique constraint: a claim row is created before any send and
 * released only if that org's send fails before emails are recorded.
 */

// ---------- pure helpers (unit-tested in __tests__/incidents.test.ts) ----------

const SINCE_RE = /^(\d+)([mhd])$/;
// Window ceiling: a typo like `--since 300d` must not turn an incident email
// into a mass mailing of everyone who ever had a failed review.
export const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// Per-org goodwill ceiling without an explicit force flag.
export const MAX_CREDIT_USD = 50;

export const INCIDENT_KEY_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;

/** Parse "45m" / "3h" / "2d" or an ISO date into a window start. Null = invalid. */
export function parseSince(input: string, now: Date = new Date()): Date | null {
  const m = SINCE_RE.exec(input.trim());
  let start: Date | null = null;
  if (m) {
    const n = Number(m[1]);
    if (n > 0) {
      const ms = m[2] === "m" ? 60_000 : m[2] === "h" ? 3_600_000 : 86_400_000;
      start = new Date(now.getTime() - n * ms);
    }
  } else {
    const parsed = Date.parse(input);
    if (!Number.isNaN(parsed)) start = new Date(parsed);
  }
  if (!start) return null;
  if (start.getTime() > now.getTime()) return null;
  if (now.getTime() - start.getTime() > MAX_WINDOW_MS) return null;
  return start;
}

/** The optional goodwill paragraph appended to the incident email. */
export function buildCreditNote(creditUsd: number): string {
  if (creditUsd <= 0) return "";
  return `\n\nAs a small thank-you for your patience, we've added $${creditUsd.toFixed(2)} in free credits to your account — no action needed.`;
}

function formatUtc(iso: string): string {
  return `${iso.replace("T", " ").slice(0, 16)} UTC`;
}

// ---------- affected-org query ----------

export interface AffectedOrg {
  orgId: string;
  orgSlug: string;
  orgName: string;
  failedCount: number;
  firstFailureAt: string;
  lastFailureAt: string;
  repositories: string[];
  /** Distinct error messages, truncated, max 5 — enough to see the pattern. */
  errors: string[];
  recipients: { email: string; name: string }[];
}

const MAX_DISTINCT_ERRORS = 5;

export async function findAffectedOrgs(
  since: Date,
  match?: string,
): Promise<AffectedOrg[]> {
  const failed = await prisma.pullRequest.findMany({
    where: {
      status: "failed",
      updatedAt: { gte: since },
      ...(match
        ? { errorMessage: { contains: match, mode: "insensitive" as const } }
        : {}),
      // Never email deleted or banned orgs.
      repository: { organization: { deletedAt: null, bannedAt: null } },
    },
    select: {
      updatedAt: true,
      errorMessage: true,
      repository: {
        select: {
          fullName: true,
          organization: { select: { id: true, slug: true, name: true } },
        },
      },
    },
    orderBy: { updatedAt: "asc" },
  });

  const byOrg = new Map<string, AffectedOrg>();
  for (const pr of failed) {
    const org = pr.repository.organization;
    let entry = byOrg.get(org.id);
    if (!entry) {
      entry = {
        orgId: org.id,
        orgSlug: org.slug,
        orgName: org.name,
        failedCount: 0,
        firstFailureAt: pr.updatedAt.toISOString(),
        lastFailureAt: pr.updatedAt.toISOString(),
        repositories: [],
        errors: [],
        recipients: [],
      };
      byOrg.set(org.id, entry);
    }
    entry.failedCount++;
    entry.lastFailureAt = pr.updatedAt.toISOString();
    if (!entry.repositories.includes(pr.repository.fullName)) {
      entry.repositories.push(pr.repository.fullName);
    }
    const msg = (pr.errorMessage ?? "unknown error").slice(0, 200);
    if (entry.errors.length < MAX_DISTINCT_ERRORS && !entry.errors.includes(msg)) {
      entry.errors.push(msg);
    }
  }

  const orgs = [...byOrg.values()];
  for (const org of orgs) {
    org.recipients = await getAdminRecipients(org.orgId);
  }
  return orgs;
}

// ---------- notify executor ----------

export class IncidentNotifyError extends Error {}

export interface NotifyParams {
  incidentKey: string;
  since: Date;
  match?: string;
  templateSlug: string;
  creditUsd: number;
  summary?: string;
  dryRun: boolean;
}

export interface OrgOutcome {
  orgSlug: string;
  orgName: string;
  failedCount: number;
  recipients: string[];
  creditUsd: number;
  action: "planned" | "sent" | "skipped" | "error";
  reason?: string;
}

export interface NotifyResult {
  dryRun: boolean;
  incidentKey: string;
  /** Resolved window start (ISO) — clients pin the live send to the dry-run's window with this. */
  since: string;
  orgs: OrgOutcome[];
  totals: { orgs: number; emails: number; creditUsd: number };
}

export async function notifyAffectedOrgs(params: NotifyParams): Promise<NotifyResult> {
  const template = await prisma.emailTemplate.findUnique({
    where: { slug: params.templateSlug },
    select: { enabled: true },
  });
  if (!template?.enabled) {
    throw new IncidentNotifyError(
      `email template "${params.templateSlug}" not found or disabled — seed templates first`,
    );
  }

  const affected = await findAffectedOrgs(params.since, params.match);
  const outcomes: OrgOutcome[] = [];

  for (const org of affected) {
    const base: Omit<OrgOutcome, "action"> = {
      orgSlug: org.orgSlug,
      orgName: org.orgName,
      failedCount: org.failedCount,
      recipients: org.recipients.map((r) => r.email),
      creditUsd: params.creditUsd,
    };

    const already = await prisma.incidentComm.findUnique({
      where: {
        incidentKey_organizationId: {
          incidentKey: params.incidentKey,
          organizationId: org.orgId,
        },
      },
      select: { id: true },
    });
    if (already) {
      outcomes.push({ ...base, action: "skipped", reason: "already notified for this incidentKey" });
      continue;
    }
    if (org.recipients.length === 0) {
      outcomes.push({ ...base, action: "skipped", reason: "no owner/admin recipients" });
      continue;
    }
    if (params.dryRun) {
      outcomes.push({ ...base, action: "planned" });
      continue;
    }

    // Claim first — the unique constraint makes concurrent or repeated runs safe.
    try {
      await prisma.incidentComm.create({
        data: { incidentKey: params.incidentKey, organizationId: org.orgId },
      });
    } catch {
      outcomes.push({ ...base, action: "skipped", reason: "already notified (concurrent claim)" });
      continue;
    }

    // Emails first, then record them on the claim, then credits. A failure
    // BEFORE emails are recorded releases the claim so a retry re-attempts
    // the org (worst case: one org's recipients get a duplicate email). A
    // failure AFTER keeps the claim — no duplicate email is possible, and
    // the outcome tells the operator to grant the missing credit manually.
    let emailsRecorded = false;
    try {
      const rendered = await renderEmailTemplate(params.templateSlug, {
        orgName: escapeHtml(org.orgName),
        failedCount: String(org.failedCount),
        windowStart: formatUtc(org.firstFailureAt),
        windowEnd: formatUtc(org.lastFailureAt),
        creditNote: buildCreditNote(params.creditUsd),
        incidentSummary: escapeHtml(params.summary ?? ""),
      });
      if (!rendered) {
        throw new Error(`template "${params.templateSlug}" failed to render`);
      }

      let emailsSent = 0;
      for (const recipient of org.recipients) {
        await sendEmail({ to: recipient.email, subject: rendered.subject, html: rendered.html });
        emailsSent++;
      }

      await prisma.incidentComm.update({
        where: {
          incidentKey_organizationId: {
            incidentKey: params.incidentKey,
            organizationId: org.orgId,
          },
        },
        data: { emailsSent },
      });
      emailsRecorded = true;

      if (params.creditUsd > 0) {
        await addFreeCredits(
          org.orgId,
          params.creditUsd,
          `Goodwill credit — incident ${params.incidentKey}`,
        );
        await prisma.incidentComm.update({
          where: {
            incidentKey_organizationId: {
              incidentKey: params.incidentKey,
              organizationId: org.orgId,
            },
          },
          data: { creditGrantedUsd: params.creditUsd },
        });
      }

      await writeAuditLog({
        action: "admin.incident.notify",
        category: "admin",
        organizationId: org.orgId,
        metadata: {
          incidentKey: params.incidentKey,
          emailsSent,
          creditUsd: params.creditUsd,
          failedCount: org.failedCount,
        },
      });

      outcomes.push({ ...base, action: "sent" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!emailsRecorded) {
        await prisma.incidentComm
          .delete({
            where: {
              incidentKey_organizationId: {
                incidentKey: params.incidentKey,
                organizationId: org.orgId,
              },
            },
          })
          .catch(() => {});
        outcomes.push({
          ...base,
          action: "error",
          reason: `${msg} (claim released — a retry re-attempts this org)`,
        });
      } else {
        outcomes.push({
          ...base,
          action: "error",
          reason: `${msg} (emails already sent — grant credits manually with \`octp admin credits grant\`)`,
        });
      }
    }
  }

  const sentOrPlanned = outcomes.filter((o) => o.action === "sent" || o.action === "planned");
  return {
    dryRun: params.dryRun,
    incidentKey: params.incidentKey,
    since: params.since.toISOString(),
    orgs: outcomes,
    totals: {
      orgs: sentOrPlanned.length,
      emails: sentOrPlanned.reduce((sum, o) => sum + o.recipients.length, 0),
      creditUsd: sentOrPlanned.reduce((sum, o) => sum + o.creditUsd, 0),
    },
  };
}
