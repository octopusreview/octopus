import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { KnowledgeContent } from "./knowledge-content";

export default async function KnowledgePage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;

  const member = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      ...(currentOrgId ? { organizationId: currentOrgId } : {}),
      deletedAt: null,
    },
    select: {
      organizationId: true,
    },
  });

  if (!member) redirect("/complete-profile");

  const orgId = member.organizationId;

  const [activeDocuments, deletedDocuments, addedTemplates] = await Promise.all([
    prisma.knowledgeDocument.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: {
        id: true,
        title: true,
        sourceType: true,
        fileName: true,
        status: true,
        errorMessage: true,
        totalChunks: true,
        totalVectors: true,
        processingMs: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.knowledgeDocument.findMany({
      where: { organizationId: orgId, deletedAt: { not: null } },
      select: {
        id: true,
        title: true,
        deletedAt: true,
        deletedBy: { select: { name: true } },
      },
      orderBy: { deletedAt: "desc" },
    }),
    prisma.knowledgeDocument.findMany({
      where: { organizationId: orgId, templateId: { not: null }, deletedAt: null },
      select: { templateId: true },
    }),
  ]);

  const documents = activeDocuments.map((doc) => ({
    ...doc,
    createdAt: doc.createdAt.toISOString(),
  }));

  const deleted = deletedDocuments.map((doc) => ({
    ...doc,
    deletedAt: doc.deletedAt!.toISOString(),
    deletedByName: doc.deletedBy?.name ?? null,
  }));

  const addedTemplateIds = addedTemplates
    .map((d) => d.templateId)
    .filter((id): id is string => id !== null);

  return (
    <KnowledgeContent
      documents={documents}
      deletedDocuments={deleted}
      addedTemplateIds={addedTemplateIds}
      orgId={orgId}
    />
  );
}
