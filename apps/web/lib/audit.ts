import { prisma, type Prisma } from "@octopus/db";

/**
 * Canonical list of audit-log categories. Any API endpoint accepting a
 * `category` query string MUST validate against this set before passing to
 * the Prisma `where` — otherwise the caller can enumerate / pollute audit
 * metadata with attacker-controlled values.
 */
export const AUDIT_CATEGORIES = [
  "auth",
  "email",
  "review",
  "repo",
  "knowledge",
  "billing",
  "admin",
  "system",
] as const;

const AUDIT_CATEGORY_SET = new Set<string>(AUDIT_CATEGORIES);

/**
 * Returns the category string if it's a known audit category, otherwise undefined.
 * Use in route handlers that accept a `category` query param.
 */
export function validateAuditCategory(value: string | null | undefined): string | undefined {
  return value && AUDIT_CATEGORY_SET.has(value) ? value : undefined;
}

/**
 * Default retention window for AuditLog rows on hosted Octopus.
 * Overridable via AUDIT_LOG_RETENTION_DAYS env var. Self-hosters who need
 * a different retention (e.g. SOC2 requires 365+, HIPAA needs 6 years)
 * can set this in their environment.
 */
export const AUDIT_LOG_DEFAULT_RETENTION_DAYS = 365;

/**
 * Delete AuditLog rows older than the configured retention window.
 * Idempotent and safe to run repeatedly — only rows past the cutoff are
 * removed. Returns the number of deleted rows so the calling pg-boss job
 * can log the result.
 *
 * The retention enforcement runs on a daily schedule (see queue-workers.ts
 * and the boss.schedule call in instrumentation.ts). Self-hosters can
 * disable it by leaving the schedule unset.
 */
export async function enforceAuditLogRetention(retentionDays?: number): Promise<number> {
  const envOverride = process.env.AUDIT_LOG_RETENTION_DAYS;
  const days = retentionDays ?? (envOverride ? parseInt(envOverride, 10) : AUDIT_LOG_DEFAULT_RETENTION_DAYS);
  if (!Number.isFinite(days) || days <= 0) {
    console.warn(`[audit] enforceAuditLogRetention: invalid days=${days}, skipping`);
    return 0;
  }
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { count } = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  if (count > 0) {
    console.log(`[audit] enforceAuditLogRetention: deleted ${count} rows older than ${days} days`);
  }
  return count;
}

export type AuditCategory =
  | "auth"
  | "email"
  | "review"
  | "repo"
  | "knowledge"
  | "billing"
  | "admin"
  | "system";

export interface AuditEntry {
  action: string;
  category: AuditCategory;
  actorId?: string | null;
  actorEmail?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  organizationId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Compares `before` and `after` objects, returning only the fields that changed.
 * Useful for logging field-level changes in audit metadata.
 *
 * Usage:
 *   const org = await prisma.organization.findUniqueOrThrow({ where: { id } });
 *   const updates = { name: "New Name" };
 *   const changes = diffFields(org, updates);
 *   // changes => { name: { old: "Old Name", new: "New Name" } }
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Record<string, { old: unknown; new: unknown }> {
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const key of Object.keys(after) as (keyof T & string)[]) {
    if (before[key] !== after[key]) {
      changes[key] = { old: before[key], new: after[key] };
    }
  }
  return changes;
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        category: entry.category,
        actorId: entry.actorId ?? null,
        actorEmail: entry.actorEmail ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        organizationId: entry.organizationId ?? null,
        metadata: entry.metadata ?? {},
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  } catch (err) {
    console.error("[audit] Failed to write audit log:", err);
  }
}
