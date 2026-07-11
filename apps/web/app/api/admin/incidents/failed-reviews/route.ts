import { NextRequest, NextResponse } from "next/server";
import { isAdminApiAuthorized } from "@/lib/admin-auth";
import { findAffectedOrgs, parseSince } from "@/lib/incidents";

/**
 * GET /api/admin/incidents/failed-reviews?since=3h&match=429
 *
 * Failed reviews inside the window, grouped per organization with the
 * owner/admin recipients an incident notification would go to. Read-only —
 * the write side is POST /api/admin/incidents/notify.
 */
export async function GET(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const sinceRaw = url.searchParams.get("since") ?? "3h";
  const match = url.searchParams.get("match") ?? undefined;

  const since = parseSince(sinceRaw);
  if (!since) {
    return NextResponse.json(
      { error: `invalid since "${sinceRaw}" — use 45m / 3h / 2d (max 30d) or an ISO date` },
      { status: 400 },
    );
  }

  const orgs = await findAffectedOrgs(since, match);

  return NextResponse.json({
    since: since.toISOString(),
    until: new Date().toISOString(),
    match: match ?? null,
    totals: {
      orgs: orgs.length,
      failedReviews: orgs.reduce((sum, o) => sum + o.failedCount, 0),
    },
    orgs,
  });
}
