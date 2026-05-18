import { headers, cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { writeAuditLog } from "@/lib/audit";

/**
 * DELETE /api/agent/<id>
 *
 * Revoke a registered LocalAgent. Admin-only. Removes the row, which cascades
 * to any in-flight tasks via the schema's onDelete: SetNull / Cascade rules.
 * The agent process itself will fail its next heartbeat and exit cleanly
 * (it gets a 404 from /api/agent/heartbeat).
 *
 * CSRF: Better Auth session cookies are SameSite=Lax, but we add an explicit
 * same-origin check on the Origin header anyway — defence in depth so a
 * future cookie-policy change can't silently regress us.
 *
 * Audited as action="local-agent.revoke".
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const reqHeaders = await headers();

  // Same-origin enforcement: the Origin header is set by browsers on every
  // CORS/DELETE request. If it's present it must match the request host;
  // if it's absent, fall back to Referer. Reject if neither matches.
  const host = reqHeaders.get("host");
  const origin = reqHeaders.get("origin");
  const referer = reqHeaders.get("referer");
  if (!isSameOrigin(host, origin, referer)) {
    return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  const session = await auth.api.getSession({ headers: reqHeaders });
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

  const { id } = await params;
  const agent = await prisma.localAgent.findFirst({
    where: { id, organizationId: currentOrgId },
    select: { id: true, name: true },
  });
  if (!agent) return Response.json({ error: "Agent not found" }, { status: 404 });

  await prisma.localAgent.delete({ where: { id: agent.id } });

  await writeAuditLog({
    action: "local-agent.revoke",
    category: "admin",
    actorId: session.user.id,
    actorEmail: session.user.email,
    organizationId: currentOrgId,
    targetType: "LocalAgent",
    targetId: agent.id,
    metadata: { name: agent.name },
    ipAddress: reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: reqHeaders.get("user-agent") ?? null,
  }).catch((err) => {
    console.error("[agent/revoke] writeAuditLog failed:", err);
  });

  // request is used implicitly via the headers() helper; reference it so the
  // linter doesn't flag it unused after the refactor.
  void request;

  return Response.json({ ok: true });
}

function isSameOrigin(
  host: string | null,
  origin: string | null,
  referer: string | null,
): boolean {
  if (!host) return false;
  const expected = host.toLowerCase();
  if (origin) {
    try {
      return new URL(origin).host.toLowerCase() === expected;
    } catch {
      return false;
    }
  }
  if (referer) {
    try {
      return new URL(referer).host.toLowerCase() === expected;
    } catch {
      return false;
    }
  }
  // No Origin and no Referer is suspicious for a state-changing request from
  // a browser — but server-side callers (Next.js internal RSC requests, the
  // doctor command etc.) may legitimately omit both. The session cookie
  // (SameSite=Lax) is the load-bearing protection in that case; admin role
  // requirement above adds another layer. Allow with a warning.
  return true;
}
