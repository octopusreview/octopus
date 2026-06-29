import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { AuditLogTable } from "./audit-log-table";
import { AUDIT_LOG_DEFAULT_RETENTION_DAYS } from "@/lib/audit";

/**
 * Admin-only Audit Log viewer.
 *
 * Server component does:
 *   - Auth + admin role check (redirects on failure)
 *   - Loads the first page of entries to avoid a render→fetch flash
 *   - Hands off to the client component for filter + pagination + export buttons
 *
 * The client component re-fetches /api/audit-log on filter changes and uses
 * the export endpoints for CSV/JSON downloads.
 */
export default async function AuditLogPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;

  const member = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      ...(currentOrgId ? { organizationId: currentOrgId } : {}),
      deletedAt: null,
    },
    select: { role: true, organizationId: true },
  });
  if (!member) redirect("/dashboard");
  if (member.role !== "owner" && member.role !== "admin") redirect("/settings");

  const initialEntries = await prisma.auditLog.findMany({
    where: { organizationId: member.organizationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
  });

  const initialCursor = initialEntries.length === 50 ? initialEntries[49].id : null;

  // Derive the retention window the same way enforceAuditLogRetention does, so
  // the displayed number matches the actual cleanup (handles empty/invalid env).
  const parsedRetention = Number(process.env.AUDIT_LOG_RETENTION_DAYS);
  const retentionDays =
    Number.isFinite(parsedRetention) && parsedRetention > 0
      ? parsedRetention
      : AUDIT_LOG_DEFAULT_RETENTION_DAYS;

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Audit Log</h1>
        <p className="mt-1 text-sm text-[#888]">
          Mutating actions across the organisation — auth, billing, integrations,
          knowledge, admin operations. Retained for {retentionDays} days.
        </p>
      </div>

      <AuditLogTable
        initialEntries={initialEntries.map((e) => ({
          id: e.id,
          action: e.action,
          category: e.category,
          actorEmail: e.actorEmail,
          targetType: e.targetType,
          targetId: e.targetId,
          ipAddress: e.ipAddress,
          createdAt: e.createdAt.toISOString(),
        }))}
        initialCursor={initialCursor}
      />
    </div>
  );
}
