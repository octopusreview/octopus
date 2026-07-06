import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@octopus/db";

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.ADMIN_API_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization");
  if (!header) return false;
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  return token === expected;
}

/** Revoke a service token (soft-delete). No-op if already revoked/unknown. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const { count } = await prisma.serviceToken.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (count > 0) console.log(`[admin] service-token revoke id=${id}`);
  return NextResponse.json({ ok: count > 0 });
}
