import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { isActionId } from "@/lib/action-input";
import { isPostgresSafeJson, readBoundedJson } from "@/lib/bounded-json";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { hasOrgPermission, normalizeOrgScopes } from "@/lib/org-permissions";
import { writeAuditLog } from "@/lib/audit";

const ASSIGNABLE_ROLES = ["admin", "member"];

// PATCH /api/orgs/:orgId/members/:memberId — Update member role and/or scopes
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; memberId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId, memberId } = await params;
  if (!isActionId(orgId) || !isActionId(memberId)) {
    return NextResponse.json({ error: "Invalid member or organization" }, { status: 400 });
  }
  const parsed = await readBoundedJson(request, 65_536);
  if (!parsed.ok) {
    return NextResponse.json({ error: "Invalid request body" }, { status: parsed.reason === "too_large" ? 413 : 400 });
  }
  const body = parsed.value;
  if (!body || typeof body !== "object" || Array.isArray(body) || !isPostgresSafeJson(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { role, scopes } = body as Record<string, unknown>;

  if (role === undefined && scopes === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  if (role !== undefined && (typeof role !== "string" || !ASSIGNABLE_ROLES.includes(role))) {
    return NextResponse.json(
      { error: `Invalid role. Must be one of: ${ASSIGNABLE_ROLES.join(", ")}` },
      { status: 400 },
    );
  }
  let normalizedScopes: string[] | undefined;
  if (scopes !== undefined) {
    try {
      normalizedScopes = normalizeOrgScopes(scopes);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid scopes" },
        { status: 400 },
      );
    }
  }

  // Caller needs members:manage (owner/admin baseline, or an explicit grant)
  const caller = await prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId: session.user.id,
      deletedAt: null,
    },
    select: { role: true, scopes: true },
  });
  if (!caller || !hasOrgPermission(caller, "members:manage")) {
    return NextResponse.json(
      { error: "Forbidden: member management permission required" },
      { status: 403 },
    );
  }

  const target = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId: orgId, deletedAt: null },
  });
  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // Cannot change your own role or grants (blocks self-escalation)
  if (target.userId === session.user.id) {
    return NextResponse.json(
      { error: "Cannot change your own role or permissions" },
      { status: 400 },
    );
  }

  // Cannot change owner role
  if (role !== undefined && target.role === "owner") {
    return NextResponse.json({ error: "Cannot change the owner's role" }, { status: 400 });
  }

  if (role !== undefined && scopes === undefined && target.role === role) {
    return NextResponse.json({ error: "Member already has this role" }, { status: 400 });
  }

  const updated = await prisma.organizationMember.update({
    where: { id: memberId },
    data: {
      ...(role !== undefined && target.role !== "owner" ? { role } : {}),
      ...(normalizedScopes !== undefined ? { scopes: normalizedScopes } : {}),
    },
    select: {
      id: true,
      role: true,
      scopes: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });

  if (normalizedScopes !== undefined) {
    await writeAuditLog({
      action: "org.member_scopes_changed",
      category: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      targetType: "user",
      targetId: target.userId,
      organizationId: orgId,
      metadata: { from: target.scopes, to: normalizedScopes },
    });
  }

  return NextResponse.json({ member: updated });
}

// DELETE /api/orgs/:orgId/members/:memberId — Remove member from organization (soft delete)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ orgId: string; memberId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId, memberId } = await params;

  // Caller must be owner or admin
  const caller = await prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId: session.user.id,
      deletedAt: null,
    },
  });
  if (!caller || !hasOrgPermission(caller, "members:manage")) {
    return NextResponse.json({ error: "Forbidden: admin role required" }, { status: 403 });
  }

  const target = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId: orgId, deletedAt: null },
  });
  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // Cannot remove yourself
  if (target.userId === session.user.id) {
    return NextResponse.json({ error: "Cannot remove yourself" }, { status: 400 });
  }

  // Cannot remove the owner
  if (target.role === "owner") {
    return NextResponse.json({ error: "Cannot remove the owner" }, { status: 400 });
  }

  await prisma.organizationMember.update({
    where: { id: memberId },
    data: { deletedAt: new Date(), removedById: session.user.id },
  });

  return NextResponse.json({ success: true });
}
