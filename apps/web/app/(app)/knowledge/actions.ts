"use server";

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { pubby } from "@/lib/pubby";
import { eventBus } from "@/lib/events";
import { deleteKnowledgeDocumentChunks } from "@/lib/qdrant";
import Anthropic from "@anthropic-ai/sdk";
import { logAiUsage } from "@/lib/ai-usage";
import { knowledgeTemplates } from "@/lib/knowledge-templates";

export async function createKnowledgeDocument(
  _prevState: { error?: string },
  formData: FormData,
): Promise<{ error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) return { error: "No organization selected." };

  const member = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id, organizationId: orgId, deletedAt: null },
    select: { id: true },
  });
  if (!member) return { error: "You are not a member of this organization." };

  const title = formData.get("title") as string;
  const content = formData.get("content") as string;
  const sourceType = (formData.get("sourceType") as string) || "paste";
  const fileName = formData.get("fileName") as string | null;

  if (!title?.trim()) return { error: "Title is required." };
  if (!content?.trim()) return { error: "Content is required." };

  const doc = await prisma.knowledgeDocument.create({
    data: {
      title: title.trim(),
      content,
      sourceType,
      fileName: fileName || null,
      status: "processing",
      organizationId: orgId,
    },
  });

  await prisma.knowledgeAuditLog.create({
    data: {
      action: "created",
      documentId: doc.id,
      userId: session.user.id,
      organizationId: orgId,
    },
  });

  const channel = `presence-org-${orgId}`;
  pubby.trigger(channel, "knowledge-status", {
    documentId: doc.id,
    status: "processing",
  });

  // Fire-and-forget background indexing
  (async () => {
    try {
      const { indexKnowledgeDocument } = await import(
        "@/lib/knowledge-indexer"
      );
      const result = await indexKnowledgeDocument(
        doc.id,
        orgId,
        doc.title,
        doc.content,
      );

      await prisma.knowledgeDocument.update({
        where: { id: doc.id },
        data: {
          status: "ready",
          totalChunks: result.totalChunks,
          totalVectors: result.totalVectors,
          processingMs: result.durationMs,
        },
      });

      pubby.trigger(channel, "knowledge-status", {
        documentId: doc.id,
        status: "ready",
        totalChunks: result.totalChunks,
        totalVectors: result.totalVectors,
      });

      eventBus.emit({
        type: "knowledge-ready",
        orgId,
        documentTitle: doc.title,
        action: "created",
        totalChunks: result.totalChunks,
        totalVectors: result.totalVectors,
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";
      console.error(
        `[knowledge] Indexing failed for doc ${doc.id}:`,
        err,
      );

      await prisma.knowledgeDocument
        .update({
          where: { id: doc.id },
          data: { status: "error", errorMessage },
        })
        .catch((e) =>
          console.error("[knowledge] Failed to update error status:", e),
        );

      pubby.trigger(channel, "knowledge-status", {
        documentId: doc.id,
        status: "error",
        error: errorMessage,
      });
    }
  })();

  revalidatePath("/knowledge");
  return {};
}

export async function getKnowledgeDocument(
  documentId: string,
): Promise<{ content: string; title: string } | { error: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) return { error: "No organization selected." };

  const doc = await prisma.knowledgeDocument.findUnique({
    where: { id: documentId },
    select: {
      title: true,
      content: true,
      organizationId: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!doc || doc.organization.members.length === 0) {
    return { error: "Document not found." };
  }

  if (doc.organizationId !== orgId) {
    return { error: "Document does not belong to this organization." };
  }

  return { content: doc.content, title: doc.title };
}

export async function updateKnowledgeDocument(
  documentId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) return { error: "No organization selected." };

  const doc = await prisma.knowledgeDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      organizationId: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!doc || doc.organization.members.length === 0) {
    return { error: "Document not found." };
  }

  if (doc.organizationId !== orgId) {
    return { error: "Document does not belong to this organization." };
  }

  const title = (formData.get("title") as string)?.trim();
  const content = (formData.get("content") as string)?.trim();

  if (!title) return { error: "Title is required." };
  if (!content) return { error: "Content is required." };

  await prisma.knowledgeDocument.update({
    where: { id: documentId },
    data: { title, content, status: "processing" },
  });

  await prisma.knowledgeAuditLog.create({
    data: {
      action: "updated",
      documentId,
      userId: session.user.id,
      organizationId: orgId,
    },
  });

  const channel = `presence-org-${orgId}`;
  pubby.trigger(channel, "knowledge-status", {
    documentId,
    status: "processing",
  });

  // Fire-and-forget re-indexing
  (async () => {
    try {
      await deleteKnowledgeDocumentChunks(documentId);

      const { indexKnowledgeDocument } = await import(
        "@/lib/knowledge-indexer"
      );
      const result = await indexKnowledgeDocument(
        documentId,
        orgId,
        title,
        content,
      );

      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: {
          status: "ready",
          totalChunks: result.totalChunks,
          totalVectors: result.totalVectors,
          processingMs: result.durationMs,
        },
      });

      pubby.trigger(channel, "knowledge-status", {
        documentId,
        status: "ready",
        totalChunks: result.totalChunks,
        totalVectors: result.totalVectors,
      });

      eventBus.emit({
        type: "knowledge-ready",
        orgId,
        documentTitle: title,
        action: "updated",
        totalChunks: result.totalChunks,
        totalVectors: result.totalVectors,
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";
      console.error(
        `[knowledge] Re-indexing failed for doc ${documentId}:`,
        err,
      );

      await prisma.knowledgeDocument
        .update({
          where: { id: documentId },
          data: { status: "error", errorMessage },
        })
        .catch((e) =>
          console.error("[knowledge] Failed to update error status:", e),
        );

      pubby.trigger(channel, "knowledge-status", {
        documentId,
        status: "error",
        error: errorMessage,
      });
    }
  })();

  revalidatePath("/knowledge");
  return {};
}

export async function deleteKnowledgeDocument(
  documentId: string,
): Promise<{ error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) return { error: "No organization selected." };

  const doc = await prisma.knowledgeDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      organizationId: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!doc || doc.organization.members.length === 0) {
    return { error: "Document not found." };
  }

  if (doc.organizationId !== orgId) {
    return { error: "Document does not belong to this organization." };
  }

  await deleteKnowledgeDocumentChunks(documentId);

  await prisma.knowledgeDocument.update({
    where: { id: documentId },
    data: {
      deletedAt: new Date(),
      deletedById: session.user.id,
    },
  });

  await prisma.knowledgeAuditLog.create({
    data: {
      action: "deleted",
      documentId,
      userId: session.user.id,
      organizationId: orgId,
    },
  });

  const channel = `presence-org-${orgId}`;
  pubby.trigger(channel, "knowledge-status", {
    documentId,
    status: "deleted",
  });

  revalidatePath("/knowledge");
  return {};
}

export async function restoreKnowledgeDocument(
  documentId: string,
): Promise<{ error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) return { error: "No organization selected." };

  const doc = await prisma.knowledgeDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      title: true,
      content: true,
      organizationId: true,
      deletedAt: true,
      organization: {
        select: {
          members: {
            where: { userId: session.user.id, deletedAt: null },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!doc || doc.organization.members.length === 0) {
    return { error: "Document not found." };
  }

  if (doc.organizationId !== orgId) {
    return { error: "Document does not belong to this organization." };
  }

  if (!doc.deletedAt) {
    return { error: "Document is not deleted." };
  }

  await prisma.knowledgeDocument.update({
    where: { id: documentId },
    data: {
      deletedAt: null,
      deletedById: null,
      status: "processing",
    },
  });

  await prisma.knowledgeAuditLog.create({
    data: {
      action: "restored",
      documentId,
      userId: session.user.id,
      organizationId: orgId,
    },
  });

  const channel = `presence-org-${orgId}`;
  pubby.trigger(channel, "knowledge-status", {
    documentId,
    status: "restored",
  });

  // Fire-and-forget re-indexing
  (async () => {
    try {
      const { indexKnowledgeDocument } = await import(
        "@/lib/knowledge-indexer"
      );
      const result = await indexKnowledgeDocument(
        doc.id,
        orgId,
        doc.title,
        doc.content,
      );

      await prisma.knowledgeDocument.update({
        where: { id: doc.id },
        data: {
          status: "ready",
          totalChunks: result.totalChunks,
          totalVectors: result.totalVectors,
          processingMs: result.durationMs,
        },
      });

      pubby.trigger(channel, "knowledge-status", {
        documentId: doc.id,
        status: "ready",
        totalChunks: result.totalChunks,
        totalVectors: result.totalVectors,
      });

      eventBus.emit({
        type: "knowledge-ready",
        orgId,
        documentTitle: doc.title,
        action: "restored",
        totalChunks: result.totalChunks,
        totalVectors: result.totalVectors,
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";
      console.error(
        `[knowledge] Re-indexing failed for restored doc ${doc.id}:`,
        err,
      );

      await prisma.knowledgeDocument
        .update({
          where: { id: doc.id },
          data: { status: "error", errorMessage },
        })
        .catch((e) =>
          console.error("[knowledge] Failed to update error status:", e),
        );

      pubby.trigger(channel, "knowledge-status", {
        documentId: doc.id,
        status: "error",
        error: errorMessage,
      });
    }
  })();

  revalidatePath("/knowledge");
  return {};
}

export async function enhanceKnowledgeContent(
  rawContent: string,
): Promise<{ content?: string; error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) return { error: "No organization selected." };

  if (!rawContent?.trim()) return { error: "Content is required." };

  const model = "claude-haiku-4-5-20251001";

  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { anthropicApiKey: true },
    });

    const client = new Anthropic({
      apiKey: org?.anthropicApiKey || process.env.ANTHROPIC_API_KEY!,
    });

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: rawContent.trim(),
        },
      ],
      system: `You are a technical writing assistant that transforms rough notes, ideas, or informal descriptions into well-structured coding rule documents in English.

Your task:
- Take the user's raw input (which may be in any language) and convert it into a comprehensive, clear, and actionable set of coding rules/guidelines in English.
- Use Markdown formatting with clear headings, bullet points, and code examples where appropriate.
- Expand brief notes into detailed, unambiguous rules that a developer or an AI code reviewer can follow.
- Add context, rationale, and examples for each rule when possible.
- Group related rules under logical sections.
- Use imperative language (e.g., "Do not...", "Always...", "Use...").
- Keep the document professional and concise — no fluff.

Output ONLY the enhanced document content. Do not add meta-commentary or explanations about what you did.`,
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    await logAiUsage({
      provider: "anthropic",
      model,
      operation: "knowledge-enhance",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      organizationId: orgId,
    });

    return { content: text };
  } catch (err) {
    console.error("[knowledge] Enhance failed:", err);
    return { error: "Failed to enhance content. Please try again." };
  }
}

export async function getKnowledgeAuditLogs(documentId: string) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) return [];

  const logs = await prisma.knowledgeAuditLog.findMany({
    where: { documentId, organizationId: orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      action: true,
      details: true,
      createdAt: true,
      user: { select: { name: true } },
    },
  });

  return logs.map((log) => ({
    ...log,
    createdAt: log.createdAt.toISOString(),
    userName: log.user.name,
  }));
}

export async function addKnowledgeTemplate(
  templateId: string,
): Promise<{ error?: string }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const orgId = cookieStore.get("current_org_id")?.value;
  if (!orgId) return { error: "No organization selected." };

  const member = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id, organizationId: orgId, deletedAt: null },
    select: { id: true },
  });
  if (!member) return { error: "You are not a member of this organization." };

  const template = knowledgeTemplates.find((t) => t.id === templateId);
  if (!template) return { error: "Template not found." };

  let doc;
  try {
    doc = await prisma.knowledgeDocument.create({
      data: {
        title: template.title,
        content: template.content,
        sourceType: "template",
        templateId,
        status: "processing",
        organizationId: orgId,
      },
    });
  } catch (e: unknown) {
    if (
      e instanceof Error &&
      "code" in e &&
      (e as { code: string }).code === "P2002"
    ) {
      return { error: "This template has already been added." };
    }
    throw e;
  }

  await prisma.knowledgeAuditLog.create({
    data: {
      action: "created",
      details: "Added from template",
      documentId: doc.id,
      userId: session.user.id,
      organizationId: orgId,
    },
  });

  const channel = `presence-org-${orgId}`;
  pubby.trigger(channel, "knowledge-status", {
    documentId: doc.id,
    status: "processing",
  });

  // Fire-and-forget background indexing
  (async () => {
    try {
      const { indexKnowledgeDocument } = await import(
        "@/lib/knowledge-indexer"
      );
      const result = await indexKnowledgeDocument(
        doc.id,
        orgId,
        doc.title,
        doc.content,
      );

      await prisma.knowledgeDocument.update({
        where: { id: doc.id },
        data: {
          status: "ready",
          totalChunks: result.totalChunks,
          totalVectors: result.totalVectors,
          processingMs: result.durationMs,
        },
      });

      pubby.trigger(channel, "knowledge-status", {
        documentId: doc.id,
        status: "ready",
        totalChunks: result.totalChunks,
        totalVectors: result.totalVectors,
      });

      eventBus.emit({
        type: "knowledge-ready",
        orgId,
        documentTitle: doc.title,
        action: "created",
        totalChunks: result.totalChunks,
        totalVectors: result.totalVectors,
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";
      console.error(
        `[knowledge] Indexing failed for template doc ${doc.id}:`,
        err,
      );

      await prisma.knowledgeDocument
        .update({
          where: { id: doc.id },
          data: { status: "error", errorMessage },
        })
        .catch((e) =>
          console.error("[knowledge] Failed to update error status:", e),
        );

      pubby.trigger(channel, "knowledge-status", {
        documentId: doc.id,
        status: "error",
        error: errorMessage,
      });
    }
  })();

  revalidatePath("/knowledge");
  return {};
}
