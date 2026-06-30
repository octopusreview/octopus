import { NextRequest, NextResponse } from "next/server";
import { getSuperAdmin } from "@/lib/superadmin";
import { getVendorTelemetry, recordVendorAccess } from "@/lib/vendor-telemetry";
import { getClientIp } from "@/lib/request-ip";

/** Machine auth: the shared ADMIN_API_SECRET bearer (matches the other
 *  /api/admin/* routes), for programmatic monitoring. */
function hasAdminSecret(request: NextRequest): boolean {
  const expected = process.env.ADMIN_API_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization");
  if (!header) return false;
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  return token === expected;
}

/**
 * GET /api/admin/telemetry — cross-org vendor telemetry aggregate. Dual auth:
 * the machine ADMIN_API_SECRET bearer OR a super-admin browser session (so the
 * /admin/telemetry page can poll it). Returns 404 (not 401/403) to anyone else
 * so the endpoint's existence isn't disclosed.
 */
export async function GET(request: NextRequest) {
  const viaSecret = hasAdminSecret(request);
  let actor: { id: string | null; email: string };
  if (viaSecret) {
    actor = { id: null, email: "admin-api-secret" };
  } else {
    const sa = await getSuperAdmin();
    if (!sa) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    actor = { id: sa.id, email: sa.email };
  }

  // Audit the actual data egress — for BOTH machine and session access. The
  // helper throttles per actor, so the page's 10s polls log ~once per window
  // rather than every request, while still recording that this actor pulled
  // cross-org data.
  await recordVendorAccess({
    actorId: actor.id,
    actorEmail: actor.email,
    ipAddress: getClientIp(request.headers),
    userAgent: request.headers.get("user-agent") ?? null,
  });

  const data = await getVendorTelemetry();
  return NextResponse.json(data);
}
