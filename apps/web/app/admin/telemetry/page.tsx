import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getSuperAdmin } from "@/lib/superadmin";
import { getVendorTelemetry } from "@/lib/vendor-telemetry";
import { writeAuditLog } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";
import { VendorClient } from "./vendor-client";

// Per-request only: the super-admin guard reads the session, and the env
// allowlist is empty at build time (so a static prerender would bake in a 404).
export const dynamic = "force-dynamic";

/**
 * /admin/telemetry — vendor (Octopus staff) cross-org telemetry console.
 * Outside the org-scoped (app) group. Super-admin only (env allowlist); 404 for
 * everyone else so the route isn't disclosed. Hidden entirely on self-host
 * (single-tenant — nothing to aggregate). Human access is audit-logged here.
 */
export default async function VendorTelemetryPage() {
  // Middleware does not gate non-API pages, so enforce in the component.
  if (process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED === "true") notFound();

  const sa = await getSuperAdmin();
  if (!sa) notFound();

  const reqHeaders = await headers();
  await writeAuditLog({
    action: "vendor-telemetry.viewed",
    category: "system",
    actorId: sa.id,
    actorEmail: sa.email,
    targetType: "platform",
    metadata: {},
    ipAddress: getClientIp(reqHeaders),
    userAgent: reqHeaders.get("user-agent") ?? null,
  });

  const initial = await getVendorTelemetry();
  return <VendorClient initial={initial} />;
}
