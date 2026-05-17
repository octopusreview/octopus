import { headers, cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { writeAuditLog, validateAuditCategory } from "@/lib/audit";

const MAX_EXPORT_ROWS = 10_000;

/**
 * GET /api/audit-log/export?format=csv|json&category=…&from=…&to=…
 *
 * Admin-only. Exports the org's audit log as either CSV or JSON. Caps at
 * MAX_EXPORT_ROWS per request to avoid runaway memory; pagination via the
 * regular /api/audit-log endpoint is the right tool for larger pulls.
 *
 * The export itself is audited (action="audit-log.export") so a compliance
 * reviewer can see who pulled the data and when.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;
  if (!currentOrgId) return Response.json({ error: "No active org" }, { status: 400 });

  const member = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id, organizationId: currentOrgId, deletedAt: null },
    select: { role: true },
  });
  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return Response.json({ error: "Admin role required" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") === "json" ? "json" : "csv";
  // Allow-list validate the category — see lib/audit.ts for the canonical set.
  // Without this guard the caller can pass arbitrary strings, polluting the
  // audited export metadata and enabling enumeration of made-up categories.
  const category = validateAuditCategory(searchParams.get("category"));
  const from = parseDate(searchParams.get("from"));
  const to = parseDate(searchParams.get("to"));

  const where = {
    organizationId: currentOrgId,
    ...(category ? { category } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };

  const entries = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_EXPORT_ROWS,
  });

  // Audit the export itself.
  const reqHeaders = await headers();
  await writeAuditLog({
    action: "audit-log.export",
    category: "admin",
    actorId: session.user.id,
    actorEmail: session.user.email,
    organizationId: currentOrgId,
    metadata: { format, count: entries.length, category: category ?? null, from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
    ipAddress: reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: reqHeaders.get("user-agent") ?? null,
  }).catch((err) => {
    console.error("[audit-log/export] writeAuditLog failed:", err);
  });

  const filenameStem = `octopus-audit-log-${new Date().toISOString().split("T")[0]}`;

  if (format === "json") {
    return new Response(JSON.stringify(entries, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="${filenameStem}.json"`,
      },
    });
  }

  return new Response(toCsv(entries), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filenameStem}.csv"`,
    },
  });
}

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

type AuditRow = {
  id: string;
  createdAt: Date;
  action: string;
  category: string;
  actorId: string | null;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
};

function toCsv(rows: AuditRow[]): string {
  const header = [
    "createdAt",
    "action",
    "category",
    "actorEmail",
    "actorId",
    "targetType",
    "targetId",
    "ipAddress",
    "userAgent",
    "metadata",
  ];
  const lines: string[] = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.createdAt.toISOString(),
        r.action,
        r.category,
        r.actorEmail ?? "",
        r.actorId ?? "",
        r.targetType ?? "",
        r.targetId ?? "",
        r.ipAddress ?? "",
        r.userAgent ?? "",
        JSON.stringify(r.metadata ?? null),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

function csvCell(value: string): string {
  if (value.includes('"') || value.includes(",") || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
