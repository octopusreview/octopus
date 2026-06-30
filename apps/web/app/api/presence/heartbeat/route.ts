import { NextResponse } from "next/server";
import { headers, cookies } from "next/headers";
import { prisma } from "@octopus/db";
import { auth } from "@/lib/auth";
import { liveTelemetryActive } from "@/lib/entitlements";
import { recordPresence } from "@/lib/presence";
import { isValidActivity } from "@/lib/activity-category";
import { isSameOrigin } from "@/lib/same-origin";

/**
 * POST /api/presence/heartbeat — the web client pings this every ~30s to record
 * the member's live presence + coarse current activity. Session-authenticated;
 * the org comes from the current_org_id cookie and is RE-VALIDATED against
 * membership (the cookie is never trusted as proof). Collection is gated on the
 * org being entitled + telemetry-enabled AND the member not having opted out —
 * when inactive we return { telemetry: false } so the client stops heartbeating.
 */
export async function POST(request: Request) {
  const reqHeaders = await headers();

  // CSRF defence-in-depth: this is a state-changing POST driven by the browser.
  // Use 400 (not 401/403) so the client's auth-terminal handling doesn't treat a
  // cross-origin reject as "logged out" and stop heartbeating for the session.
  if (!isSameOrigin(reqHeaders.get("host"), reqHeaders.get("origin"), reqHeaders.get("referer"))) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 400 });
  }

  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) {
    return NextResponse.json({ ok: true, telemetry: false });
  }

  // Re-validate membership server-side — never trust the cookie alone. Also read
  // the per-member opt-out so an opted-out member is never recorded.
  const membership = await prisma.organizationMember.findFirst({
    where: { organizationId: orgId, userId: session.user.id, deletedAt: null },
    select: { telemetryOptedOut: true },
  });
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Gate collection on entitlement + the org toggle + the member opt-out. Tell
  // the client to stop when inactive so a free/disabled org — or an opted-out
  // member — doesn't keep heartbeating.
  if (membership.telemetryOptedOut || !(await liveTelemetryActive(orgId))) {
    return NextResponse.json({ ok: true, telemetry: false });
  }

  const body = (await request.json().catch(() => null)) as { activity?: unknown } | null;
  // Only accept a known coarse category from the client — anything else is
  // dropped to null so a crafted body can't store arbitrary text.
  const activity = isValidActivity(body?.activity) ? body.activity : null;

  await recordPresence(orgId, session.user.id, activity);

  return NextResponse.json({ ok: true, telemetry: true });
}
