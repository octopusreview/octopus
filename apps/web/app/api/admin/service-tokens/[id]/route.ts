import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { isAdminApiAuthorized } from "@/lib/admin-auth";

/** Revoke a service token (soft-delete). No-op if already revoked/unknown. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAdminApiAuthorized(request)) {
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
