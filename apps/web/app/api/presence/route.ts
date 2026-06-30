import { NextResponse } from "next/server";
import { headers, cookies } from "next/headers";
import { prisma } from "@octopus/db";
import { auth } from "@/lib/auth";
import { liveTelemetryActive } from "@/lib/entitlements";
import { getOnlinePresence } from "@/lib/presence";
import { AGENT_STALE_THRESHOLD_MS } from "@/lib/agent-constants";

/**
 * GET /api/presence — the live roster for the org's monitor dashboard: currently
 * online members (human presence) + online local agents. Owner/admin only, and
 * only when live telemetry is active; otherwise returns empty + active:false.
 * Polled by the dashboard (presence changes aren't pushed over Pubby).
 */
export async function GET() {
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
    return NextResponse.json({ members: [], agents: [], active: false });
  }

  // Online members (presence rows) joined with display info.
  const presence = await getOnlinePresence(orgId);
  const userIds = [...new Set(presence.map((p) => p.userId))];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, image: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));
  const members = presence.map((p) => ({
    userId: p.userId,
    name: userMap.get(p.userId)?.name ?? "Unknown",
    image: userMap.get(p.userId)?.image ?? null,
    currentActivity: p.currentActivity,
    lastSeenAt: p.lastSeenAt,
  }));

  // Online local agents (same staleness window as the agent-status endpoint).
  const agentRows = await prisma.localAgent.findMany({
    where: {
      organizationId: orgId,
      status: "online",
      lastSeenAt: { gte: new Date(Date.now() - AGENT_STALE_THRESHOLD_MS) },
    },
    select: { id: true, name: true, capabilities: true, lastSeenAt: true },
  });
  const agents = agentRows.map((a) => ({
    id: a.id,
    name: a.name,
    capabilities: a.capabilities,
    lastSeenAt: a.lastSeenAt?.getTime() ?? null,
  }));

  return NextResponse.json({ members, agents, active: true });
}
