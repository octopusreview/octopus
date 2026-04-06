import Anthropic from "@anthropic-ai/sdk";
import { buildIndexWarning } from "@/lib/review-helpers";
import { prisma } from "@octopus/db";
import { pubby } from "@/lib/pubby";
import { createEmbeddings } from "@/lib/embeddings";
import {
  searchCodeChunksAcrossRepos,
  searchKnowledgeChunks,
  searchReviewChunks,
  searchChatChunks,
  searchDiagramChunks,
  ensureChatCollection,
  upsertChatChunk,
} from "@/lib/qdrant";
import { logAiUsage } from "@/lib/ai-usage";
import { getReviewModel } from "@/lib/ai-client";
import { isOrgOverSpendLimit } from "@/lib/cost";
import { generateSparseVector } from "@/lib/sparse-vector";

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return anthropicClient;
}

const STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Process the next waiting message in the queue for a conversation.
 * This runs without an HTTP connection — broadcasts via Pubby instead of SSE.
 */
export async function processNextInQueue(conversationId: string): Promise<void> {
  // Clean up stale processing entries (older than 5 minutes)
  await prisma.chatQueue.updateMany({
    where: {
      conversationId,
      status: "processing",
      startedAt: { lt: new Date(Date.now() - STALE_TIMEOUT_MS) },
    },
    data: { status: "failed" },
  });

  // Check if something is already processing
  const processing = await prisma.chatQueue.findFirst({
    where: { conversationId, status: "processing" },
  });
  if (processing) return;

  // Get next waiting entry
  const nextEntry = await prisma.chatQueue.findFirst({
    where: { conversationId, status: "waiting" },
    orderBy: { createdAt: "asc" },
  });
  if (!nextEntry) return;

  // Mark as processing
  await prisma.chatQueue.update({
    where: { id: nextEntry.id },
    data: { status: "processing", startedAt: new Date() },
  });

  const channel = `presence-chat-${conversationId}`;

  // Broadcast queue update
  const waitingCount = await prisma.chatQueue.count({
    where: { conversationId, status: "waiting" },
  });
  try {
    await pubby.trigger(channel, "chat-queue-update", {
      queueLength: waitingCount,
      nextUserId: nextEntry.userId,
    });
  } catch {}

  try {
    // Load conversation with messages
    const conversation = await prisma.chatConversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!conversation) {
      await prisma.chatQueue.update({
        where: { id: nextEntry.id },
        data: { status: "failed", completedAt: new Date() },
      });
      return;
    }

    const orgId = conversation.organizationId;
    const message = nextEntry.content;

    // Spend limit check
    if (await isOrgOverSpendLimit(orgId)) {
      console.warn(`[chat] Org ${orgId} over spend limit — rejecting chat`);
      const limitMsg = "Your organization has reached its monthly AI usage limit. Please add your own API keys in Settings to continue using chat.";
      const savedMsg = await prisma.chatMessage.create({
        data: { role: "assistant", content: limitMsg, conversationId },
      });
      try {
        await pubby.trigger(channel, "chat-message-complete", {
          id: savedMsg.id, role: "assistant", content: limitMsg,
        });
      } catch {}
      await prisma.chatQueue.update({
        where: { id: nextEntry.id },
        data: { status: "completed", completedAt: new Date() },
      });
      await processNextInQueue(conversationId);
      return;
    }

    // Build conversation history
    const historyMessages = conversation.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Get context (same as POST /api/chat)
    const [allRepos, orgMembers, knowledgeDocs, recentPRs] = await Promise.all([
      prisma.repository.findMany({
        where: { organizationId: orgId, isActive: true },
        select: {
          id: true, fullName: true, name: true, provider: true, defaultBranch: true,
          indexStatus: true, indexedAt: true, indexedFiles: true, totalFiles: true,
          totalChunks: true, contributorCount: true, contributors: true, summary: true,
          purpose: true, analysis: true, autoReview: true, createdAt: true,
          _count: { select: { pullRequests: true } },
        },
      }),
      prisma.organizationMember.findMany({
        where: { organizationId: orgId, deletedAt: null },
        select: { role: true, user: { select: { name: true, email: true } } },
      }),
      prisma.knowledgeDocument.findMany({
        where: { organizationId: orgId, status: "ready", deletedAt: null },
        select: { title: true, sourceType: true, totalChunks: true },
      }),
      prisma.pullRequest.findMany({
        where: { repository: { organizationId: orgId } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          number: true, title: true, author: true, status: true, createdAt: true,
          repository: { select: { fullName: true } },
          _count: { select: { reviewIssues: true } },
        },
      }),
    ]);

    const indexedRepos = allRepos.filter((r) => r.indexStatus === "indexed");
    const repoIds = indexedRepos.map((r) => r.id);

    const recentHistory = conversation.messages.slice(-6);
    const contextualQuery = recentHistory.length > 0
      ? [...recentHistory.map((m) => `${m.role}: ${m.content}`), `user: ${message}`].join("\n")
      : message;
    const embeddingInput = contextualQuery.length > 8000 ? contextualQuery.slice(-8000) : contextualQuery;

    const [queryVector] = await createEmbeddings([embeddingInput], { organizationId: orgId, operation: "embedding" });

    const [codeChunks, knowledgeChunks, reviewChunks, chatChunks, diagramChunks] = await Promise.all([
      repoIds.length > 0 ? searchCodeChunksAcrossRepos(repoIds, queryVector, 15, embeddingInput) : Promise.resolve([]),
      searchKnowledgeChunks(orgId, queryVector, 8, embeddingInput),
      searchReviewChunks(orgId, queryVector, 5, embeddingInput),
      searchChatChunks(orgId, queryVector, 5, conversation.id, embeddingInput),
      searchDiagramChunks(orgId, queryVector, 3, embeddingInput),
    ]);

    // Build context
    const repoMap = new Map(indexedRepos.map((r) => [r.id, r.fullName]));
    const codeContext = codeChunks
      .map((c) => `### ${repoMap.get(c.repoId) ?? "unknown"}/${c.filePath}:L${c.startLine}-L${c.endLine}\n\`\`\`\n${c.text}\n\`\`\``)
      .join("\n\n");
    const knowledgeContext = knowledgeChunks.map((c) => `### ${c.title}\n${c.text}`).join("\n\n");
    const reviewContext = reviewChunks
      .map((c) => `### ${c.repoFullName} PR #${c.prNumber}: ${c.prTitle} (by ${c.author}, ${c.reviewDate})\n${c.text}`)
      .join("\n\n");
    const diagramContext = diagramChunks
      .map((c) => `### [${(c.diagramType ?? "flowchart").toUpperCase()}] ${c.repoFullName} PR #${c.prNumber}: ${c.prTitle} (by ${c.author}, ${c.reviewDate})\n\`\`\`mermaid\n${c.mermaidCode}\n\`\`\``)
      .join("\n\n");
    const chatHistoryContext = chatChunks.length > 0
      ? chatChunks.map((c) => `### From: "${c.conversationTitle}"\n**Q:** ${c.question}\n**A:** ${c.answer}`).join("\n\n")
      : "";

    const repoList = allRepos.map((r) => {
      const contributors = Array.isArray(r.contributors) ? r.contributors as { login: string; contributions: number }[] : [];
      const topContributors = contributors.slice(0, 10).map((c) => `${c.login} (${c.contributions})`).join(", ");
      const lines = [
        `### ${r.fullName}`,
        `- Provider: ${r.provider} | Branch: ${r.defaultBranch} | Auto-review: ${r.autoReview ? "on" : "off"}`,
        `- Index: ${r.indexStatus}${r.indexedAt ? ` (${r.indexedAt.toISOString().split("T")[0]})` : ""} | Files: ${r.indexedFiles}/${r.totalFiles} | Chunks: ${r.totalChunks}`,
        `- PRs: ${r._count.pullRequests} | Contributors: ${r.contributorCount}${topContributors ? ` — ${topContributors}` : ""}`,
      ];
      const warning = buildIndexWarning(r.indexStatus);
      if (warning) lines.push(warning);
      if (r.purpose) lines.push(`- Purpose: ${r.purpose}`);
      if (r.summary) lines.push(`- Summary: ${r.summary}`);
      if (r.analysis) lines.push(`- Analysis: ${r.analysis}`);
      return lines.join("\n");
    }).join("\n\n");

    const memberList = orgMembers.map((m) => `- ${m.user.name} (${m.user.email}) — ${m.role}`).join("\n");
    const knowledgeList = knowledgeDocs.length > 0
      ? knowledgeDocs.map((d) => `- ${d.title} (${d.sourceType}, ${d.totalChunks} chunks)`).join("\n")
      : "No knowledge documents uploaded yet.";
    const prList = recentPRs.length > 0
      ? recentPRs.map((pr) => `- ${pr.repository.fullName}#${pr.number}: ${pr.title} (by ${pr.author}, ${pr.status}, ${pr._count.reviewIssues} issues) — ${pr.createdAt.toISOString().split("T")[0]}`).join("\n")
      : "No pull requests yet.";

    const systemInstructions = `You are Octopus Chat, an AI assistant with deep knowledge of the user's codebase and organization.
You help developers understand their code, find patterns, debug issues, and answer questions.
The current user is: ${nextEntry.userName}
This is a shared team conversation — multiple users may be participating.

RULES:
- Answer questions about the organization, repositories, team, and code using ALL provided context
- Cite file paths: \`path/to/file.ts:L42\`
- Be concise and technical
- Use fenced code blocks with language tags
- If context is insufficient, say so honestly`;

    const systemContext = `<organization_info>
## Team Members (${orgMembers.length})
${memberList}

## Repositories (${allRepos.length})
${repoList || "No repositories connected yet."}

## Knowledge Base (${knowledgeDocs.length} documents)
${knowledgeList}

## Recent Pull Requests (last ${recentPRs.length})
${prList}
</organization_info>

<codebase_context>
${codeContext || "No code context available for this query."}
</codebase_context>

<knowledge_context>
${knowledgeContext || "No matching knowledge documents for this query."}
</knowledge_context>

<review_context>
${reviewContext || "No matching review history for this query."}
</review_context>

<diagram_context>
${diagramContext || "No matching diagrams for this query."}
</diagram_context>

<previous_conversations>
${chatHistoryContext || "No relevant previous conversations found."}
</previous_conversations>`;

    // Broadcast stream start
    try {
      await pubby.trigger(channel, "chat-stream-start", { conversationId });
    } catch {}

    const chatModel = await getReviewModel(orgId);

    const client = getAnthropicClient();
    let fullResponse = "";
    let deltaBatch = "";
    let lastBroadcast = Date.now();

    const anthropicStream = client.messages.stream({
      model: chatModel,
      max_tokens: 4096,
      system: [
        { type: "text" as const, text: systemInstructions, cache_control: { type: "ephemeral" as const } },
        { type: "text" as const, text: systemContext },
      ],
      messages: historyMessages,
    });

    for await (const event of anthropicStream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        const text = event.delta.text;
        fullResponse += text;
        deltaBatch += text;

        // Broadcast delta batches (~200 chars or ~500ms)
        if (deltaBatch.length >= 200 || Date.now() - lastBroadcast >= 500) {
          try {
            await pubby.trigger(channel, "chat-stream-delta", { text: deltaBatch });
          } catch {}
          deltaBatch = "";
          lastBroadcast = Date.now();
        }
      }
    }

    // Flush remaining delta
    if (deltaBatch) {
      try {
        await pubby.trigger(channel, "chat-stream-delta", { text: deltaBatch });
      } catch {}
    }

    // Log usage
    const finalMessage = await anthropicStream.finalMessage();
    await logAiUsage({
      provider: "anthropic",
      model: chatModel,
      operation: "chat",
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
      organizationId: orgId,
    });

    // Save assistant message
    const savedMsg = await prisma.chatMessage.create({
      data: {
        role: "assistant",
        content: fullResponse,
        conversationId,
      },
    });

    // Broadcast completion
    try {
      await pubby.trigger(channel, "chat-message-complete", {
        id: savedMsg.id,
        role: "assistant",
        content: fullResponse,
      });
    } catch {}

    // Store Q&A in Qdrant
    if (fullResponse) {
      try {
        await ensureChatCollection();
        const qaPairText = `Q: ${message}\nA: ${fullResponse}`.slice(0, 8000);
        const [qaVector] = await createEmbeddings([qaPairText], { organizationId: orgId, operation: "embedding" });
        const conv = await prisma.chatConversation.findUnique({
          where: { id: conversationId },
          select: { title: true },
        });
        await upsertChatChunk({
          id: crypto.randomUUID(),
          vector: qaVector,
          sparseVector: generateSparseVector(qaPairText),
          payload: {
            orgId,
            userId: nextEntry.userId,
            conversationId,
            conversationTitle: conv?.title ?? "New Chat",
            question: message,
            answer: fullResponse.slice(0, 4000),
            createdAt: new Date().toISOString(),
          },
        });
      } catch {}
    }

    // Mark queue entry complete
    await prisma.chatQueue.update({
      where: { id: nextEntry.id },
      data: { status: "completed", completedAt: new Date() },
    });

    // Recursively process next
    await processNextInQueue(conversationId);
  } catch {
    // Mark as failed
    await prisma.chatQueue.update({
      where: { id: nextEntry.id },
      data: { status: "failed", completedAt: new Date() },
    }).catch(() => {});

    // Try to process next anyway
    await processNextInQueue(conversationId).catch(() => {});
  }
}
