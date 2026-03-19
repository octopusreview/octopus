import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";

const ASSIGNABLE_ROLES = ["admin", "member"];

// PATCH /api/orgs/:orgId/members/:memberId — Update member role
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; memberId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orgId, memberId } = await params;
  const body = await request.json();
  const { role } = body;

  if (!role || !ASSIGNABLE_ROLES.includes(role)) {
    return NextResponse.json(
      { error: `Invalid role. Must be one of: ${ASSIGNABLE_ROLES.join(", ")}` },
      { status: 400 },
    );
  }

  // Caller must be owner or admin
  const caller = await prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId: session.user.id,
      role: { in: ["owner", "admin"] },
      deletedAt: null,
    },
  });
  if (!caller) {
    return NextResponse.json({ error: "Forbidden: admin role required" }, { status: 403 });
  }

  const target = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId: orgId, deletedAt: null },
  });
  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // Cannot change own role
  if (target.userId === session.user.id) {
    return NextResponse.json({ error: "Cannot change your own role" }, { status: 400 });
  }

  // Cannot change owner role
  if (target.role === "owner") {
    return NextResponse.json({ error: "Cannot change the owner's role" }, { status: 400 });
  }

  // Only owner can promote to admin or demote admins
  if (caller.role !== "owner" && (target.role === "admin" || role === "admin")) {
    return NextResponse.json({ error: "Only the owner can manage admin roles" }, { status: 403 });
  }

  if (target.role === role) {
    return NextResponse.json({ error: "Member already has this role" }, { status: 400 });
  }

  const updated = await prisma.organizationMember.update({
    where: { id: memberId },
    data: { role },
    select: {
      id: true,
      role: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });

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
      role: { in: ["owner", "admin"] },
      deletedAt: null,
    },
  });
  if (!caller) {
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

  // Only owner can remove admins
  if (caller.role !== "owner" && target.role === "admin") {
    return NextResponse.json({ error: "Only the owner can remove admins" }, { status: 403 });
  }

  await prisma.organizationMember.update({
    where: { id: memberId },
    data: { deletedAt: new Date(), removedById: session.user.id },
  });

  return NextResponse.json({ success: true });
}
