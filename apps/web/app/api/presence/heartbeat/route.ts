import { NextResponse } from "next/server";
import { headers, cookies } from "next/headers";
import { prisma } from "@octopus/db";
import { auth } from "@/lib/auth";
import { liveTelemetryActive } from "@/lib/entitlements";
import { recordPresence } from "@/lib/presence";
import { isValidActivity } from "@/lib/activity-category";

/**
 * POST /api/presence/heartbeat — the web client pings this every ~30s to record
 * the member's live presence + coarse current activity. Session-authenticated;
 * the org comes from the current_org_id cookie and is RE-VALIDATED against
 * membership (the cookie is never trusted as proof). Collection is gated on the
 * org being entitled + having live telemetry enabled — when it isn't, we return
 * { telemetry: false } so the client stops heartbeating.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) {
    return NextResponse.json({ ok: true, telemetry: false });
  }

  // Re-validate membership server-side — never trust the cookie alone.
  const membership = await prisma.organizationMember.findFirst({
    where: { organizationId: orgId, userId: session.user.id, deletedAt: null },
    select: { id: true },
  });
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Gate collection on entitlement + the org toggle. Tell the client to stop
  // when inactive so a free/disabled org doesn't keep heartbeating.
  if (!(await liveTelemetryActive(orgId))) {
    return NextResponse.json({ ok: true, telemetry: false });
  }

  const body = (await request.json().catch(() => null)) as { activity?: unknown } | null;
  // Only accept a known coarse category from the client — anything else is
  // dropped to null so a crafted body can't store arbitrary text.
  const activity = isValidActivity(body?.activity) ? body.activity : null;

  await recordPresence(orgId, session.user.id, activity);

  return NextResponse.json({ ok: true, telemetry: true });
}
