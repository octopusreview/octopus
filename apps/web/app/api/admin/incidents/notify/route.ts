import { NextRequest, NextResponse } from "next/server";
import { isAdminApiAuthorized } from "@/lib/admin-auth";
import {
  INCIDENT_KEY_RE,
  IncidentNotifyError,
  MAX_CREDIT_USD,
  notifyAffectedOrgs,
  parseSince,
} from "@/lib/incidents";

interface NotifyBody {
  incidentKey?: unknown;
  since?: unknown;
  match?: unknown;
  template?: unknown;
  creditUsd?: unknown;
  summary?: unknown;
  dryRun?: unknown;
  force?: unknown;
}

/**
 * POST /api/admin/incidents/notify
 *
 * Emails owner/admin members of every org with failed reviews in the window
 * and optionally grants goodwill free credits. Dry-run unless `dryRun` is
 * explicitly false. Idempotent per (incidentKey, org) — see lib/incidents.ts.
 */
export async function POST(request: NextRequest) {
  if (!isAdminApiAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: NotifyBody;
  try {
    body = (await request.json()) as NotifyBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const incidentKey = typeof body.incidentKey === "string" ? body.incidentKey : "";
  if (!INCIDENT_KEY_RE.test(incidentKey)) {
    return NextResponse.json(
      { error: "incidentKey is required: 3-64 chars of lowercase letters, digits, dashes (e.g. openai-429-2026-07-11)" },
      { status: 400 },
    );
  }

  const sinceRaw = typeof body.since === "string" ? body.since : "3h";
  const since = parseSince(sinceRaw);
  if (!since) {
    return NextResponse.json(
      { error: `invalid since "${sinceRaw}" — use 45m / 3h / 2d (max 30d) or an ISO date` },
      { status: 400 },
    );
  }

  const creditUsd = body.creditUsd === undefined ? 0 : Number(body.creditUsd);
  if (!Number.isFinite(creditUsd) || creditUsd < 0) {
    return NextResponse.json({ error: "creditUsd must be a non-negative number" }, { status: 400 });
  }
  if (creditUsd > MAX_CREDIT_USD && body.force !== true) {
    return NextResponse.json(
      { error: `creditUsd ${creditUsd} exceeds the $${MAX_CREDIT_USD} per-org cap — pass force:true if intentional` },
      { status: 400 },
    );
  }

  try {
    const result = await notifyAffectedOrgs({
      incidentKey,
      since,
      match: typeof body.match === "string" && body.match ? body.match : undefined,
      templateSlug:
        typeof body.template === "string" && body.template ? body.template : "incident-resolved",
      creditUsd,
      summary: typeof body.summary === "string" && body.summary ? body.summary : undefined,
      // Live send requires an explicit opt-out of the default dry-run.
      dryRun: body.dryRun !== false,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof IncidentNotifyError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
