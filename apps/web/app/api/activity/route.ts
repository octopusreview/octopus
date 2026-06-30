import { NextResponse } from "next/server";
import { headers, cookies } from "next/headers";
import { prisma } from "@octopus/db";
import { auth } from "@/lib/auth";
import { liveTelemetryActive } from "@/lib/entitlements";

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * GET /api/activity — the activity feed for the org's monitor dashboard.
 * Owner/admin only, org-scoped, and only when live telemetry is active. Rows are
 * already privacy-safe (the activity.observer allowlist). Descending, cursor-
 * paginated for "load more"; the dashboard polls page 1 (no cursor) and merges
 * by id to pick up new events / reconcile dropped real-time pushes.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) return NextResponse.json({ error: "No active org" }, { status: 400 });

  const member = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id, organizationId: orgId, deletedAt: null },
    select: { role: true },
  });
  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  if (!(await liveTelemetryActive(orgId))) {
    return NextResponse.json({ events: [], nextCursor: null, active: false });
  }

  const { searchParams } = new URL(request.url);
  const rawLimit = parseInt(searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(MAX_PAGE_SIZE, Math.max(1, rawLimit)) : PAGE_SIZE;
  const cursor = searchParams.get("cursor") ?? undefined;

  const rows = await prisma.activityEvent.findMany({
    where: { organizationId: orgId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  return NextResponse.json({
    events: page.map((e) => ({
      id: e.id,
      action: e.action,
      target: e.target,
      actorType: e.actorType,
      actorId: e.actorId,
      actorLabel: e.actorLabel,
      metadata: e.metadata,
      createdAt: e.createdAt.toISOString(),
    })),
    nextCursor,
    active: true,
  });
}
