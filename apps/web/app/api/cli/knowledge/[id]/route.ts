import { authenticateApiToken } from "@/lib/api-auth";
import { prisma } from "@octopus/db";
import { NextRequest } from "next/server";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await authenticateApiToken(request);
  if (result instanceof Response) return result; // account-standing hold (403), pass through
  if (!result) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const doc = await prisma.knowledgeDocument.findFirst({
    where: { id, organizationId: result.org.id, deletedAt: null },
  });

  if (!doc) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }

  // Soft delete
  await prisma.knowledgeDocument.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: result.user.id },
  });

  await prisma.knowledgeAuditLog.create({
    data: {
      action: "deleted",
      details: "Deleted via CLI",
      documentId: id,
      userId: result.user.id,
      organizationId: result.org.id,
    },
  });

  return Response.json({ message: "Document deleted" });
}
