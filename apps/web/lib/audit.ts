import { prisma, type Prisma } from "@octopus/db";

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
