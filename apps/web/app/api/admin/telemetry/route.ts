import { NextRequest, NextResponse } from "next/server";
import { getSuperAdmin } from "@/lib/superadmin";
import { getVendorTelemetry } from "@/lib/vendor-telemetry";
import { writeAuditLog } from "@/lib/audit";
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
  if (!viaSecret) {
    const sa = await getSuperAdmin();
    if (!sa) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  // Programmatic (machine) access is otherwise an un-audited cross-org data
  // egress — log it. Human/session access is audited at the page render (once
  // per console open); the page's 10s polls are that same session and aren't
  // re-logged, to avoid flooding the audit log.
  if (viaSecret) {
    await writeAuditLog({
      action: "vendor-telemetry.api_access",
      category: "system",
      actorId: null,
      actorEmail: "admin-api-secret",
      targetType: "platform",
      metadata: {},
      ipAddress: getClientIp(request.headers),
      userAgent: request.headers.get("user-agent") ?? null,
    });
  }

  const data = await getVendorTelemetry();
  return NextResponse.json(data);
}
