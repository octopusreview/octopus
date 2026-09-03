import { authenticateApiToken } from "@/lib/api-auth";
import { prisma } from "@octopus/db";

export async function GET(request: Request) {
  const result = await authenticateApiToken(request);
  if (result instanceof Response) return result; // account-standing hold (403), pass through
  if (!result) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const docs = await prisma.knowledgeDocument.findMany({
    where: { organizationId: result.org.id, deletedAt: null },
    select: {
      id: true,
      title: true,
      sourceType: true,
      fileName: true,
      status: true,
      totalChunks: true,
      totalVectors: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return Response.json({ documents: docs });
}

export async function POST(request: Request) {
  const result = await authenticateApiToken(request);
  if (result instanceof Response) return result; // account-standing hold (403), pass through
  if (!result) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { title, content, fileName } = await request.json();
  if (!title?.trim() || !content?.trim()) {
    return Response.json({ error: "Missing title or content" }, { status: 400 });
  }
  if (title.length > 255) {
    return Response.json({ error: "Title too long (max 255 characters)" }, { status: 400 });
  }
  if (content.length > 1_000_000) {
    return Response.json({ error: "Content too long (max 1MB)" }, { status: 400 });
  }

  const doc = await prisma.knowledgeDocument.create({
    data: {
      title,
      content,
      sourceType: fileName ? "file" : "paste",
      fileName: fileName ?? null,
      organizationId: result.org.id,
    },
  });

  // Create audit log
  await prisma.knowledgeAuditLog.create({
    data: {
      action: "created",
      details: `Created via CLI`,
      documentId: doc.id,
      userId: result.user.id,
      organizationId: result.org.id,
    },
  });

  return Response.json({ document: doc }, { status: 201 });
}
