import { headers, cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * GET /api/audit-log?cursor=<id>&limit=<n>&category=<c>&actorEmail=<e>&from=<iso>&to=<iso>
 *
 * Admin-only. Returns paginated AuditLog entries for the caller's current org.
 * Pagination is cursor-based on the (createdAt, id) tuple — the response
 * includes a `nextCursor` to pass back for the next page.
 *
 * Filters (all optional):
 *   category    — one of "auth" | "email" | "review" | "repo" | "knowledge"
 *                 | "billing" | "admin" | "system"
 *   actorEmail  — exact match (case-insensitive)
 *   action      — exact match
 *   from / to   — ISO timestamps; bounds the createdAt filter
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
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(searchParams.get("limit") ?? String(PAGE_SIZE), 10)),
  );
  const cursor = searchParams.get("cursor") ?? undefined;
  const category = searchParams.get("category") ?? undefined;
  const actorEmail = searchParams.get("actorEmail")?.toLowerCase();
  const action = searchParams.get("action") ?? undefined;
  const from = parseDate(searchParams.get("from"));
  const to = parseDate(searchParams.get("to"));

  const where = {
    organizationId: currentOrgId,
    ...(category ? { category } : {}),
    ...(actorEmail ? { actorEmail: { equals: actorEmail, mode: "insensitive" as const } } : {}),
    ...(action ? { action } : {}),
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
    take: limit + 1, // one extra to know if there's a next page
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = entries.length > limit;
  const page = hasMore ? entries.slice(0, limit) : entries;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  return Response.json({
    entries: page.map((e) => ({
      id: e.id,
      action: e.action,
      category: e.category,
      actorId: e.actorId,
      actorEmail: e.actorEmail,
      targetType: e.targetType,
      targetId: e.targetId,
      metadata: e.metadata,
      ipAddress: e.ipAddress,
      userAgent: e.userAgent,
      createdAt: e.createdAt.toISOString(),
    })),
    nextCursor,
  });
}

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : undefined;
}
