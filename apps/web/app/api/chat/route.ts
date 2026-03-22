import { headers } from "next/headers";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
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
import { rerankDocuments } from "@/lib/reranker";
import { pubby } from "@/lib/pubby";
import { processNextInQueue } from "@/lib/chat-queue-processor";
import { generateSparseVector } from "@/lib/sparse-vector";

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return anthropicClient;
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { message, conversationId, orgId } = await request.json();
  if (!message || !orgId) {
    return new Response("Missing message or orgId", { status: 400 });
  }

  // Verify org membership
  const membership = await prisma.organizationMember.findFirst({
    where: {
      organizationId: orgId,
      userId: session.user.id,
      deletedAt: null,
    },
  });
  if (!membership) {
    return new Response("Not a member of this organization", { status: 403 });
  }

  // Get or create conversation — shared chats allow any org member
  let conversation;
  if (conversationId) {
    conversation = await prisma.chatConversation.findFirst({
      where: {
        id: conversationId,
        organizationId: orgId,
        OR: [
          { userId: session.user.id },
          { isShared: true },
        ],
      },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conversation) {
      return new Response("Conversation not found", { status: 404 });
    }
  } else {
    conversation = await prisma.chatConversation.create({
      data: { userId: session.user.id, organizationId: orgId },
      include: { messages: true },
    });
  }

  // Save user message with sender info
  const savedUserMsg = await prisma.chatMessage.create({
    data: {
      role: "user",
      content: message,
      conversationId: conversation.id,
      userId: session.user.id,
      userName: session.user.name,
    },
  });

  // Broadcast user message for shared chats
  if (conversation.isShared) {
    try {
      await pubby.trigger(`presence-chat-${conversation.id}`, "chat-message", {
        id: savedUserMsg.id,
        role: "user",
        content: message,
        userId: session.user.id,
        userName: session.user.name,
      });
    } catch {}

    // Queue mechanism for shared chats
    const processingEntry = await prisma.chatQueue.findFirst({
      where: { conversationId: conversation.id, status: "processing" },
    });

    if (processingEntry) {
      // AI is busy — queue this message
      const queueEntry = await prisma.chatQueue.create({
        data: {
          conversationId: conversation.id,
          userId: session.user.id,
          userName: session.user.name,
          content: message,
          status: "waiting",
        },
      });

      const waitingCount = await prisma.chatQueue.count({
        where: { conversationId: conversation.id, status: "waiting" },
      });

      // Broadcast queue update
      try {
        await pubby.trigger(`presence-chat-${conversation.id}`, "chat-queue-update", {
          queueLength: waitingCount,
          nextUserId: queueEntry.userId,
        });
      } catch {}

      return Response.json({
        queued: true,
        position: waitingCount,
        conversationId: conversation.id,
      });
    }

    // No active processing — create processing entry and continue with SSE
    await prisma.chatQueue.create({
      data: {
        conversationId: conversation.id,
        userId: session.user.id,
        userName: session.user.name,
        content: message,
        status: "processing",
        startedAt: new Date(),
      },
    });
  }

  // Build conversation history for Claude
  const historyMessages = conversation.messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
  historyMessages.push({ role: "user", content: message });

  // Get ALL org repos (for listing) and indexed ones (for RAG)
  const [allRepos, orgMembers, knowledgeDocs, recentPRs] = await Promise.all([
    prisma.repository.findMany({
      where: { organizationId: orgId, isActive: true },
      select: {
        id: true,
        fullName: true,
        name: true,
        provider: true,
        defaultBranch: true,
        indexStatus: true,
        indexedAt: true,
        indexedFiles: true,
        totalFiles: true,
        totalChunks: true,
        contributorCount: true,
        contributors: true,
        summary: true,
        purpose: true,
        analysis: true,
        autoReview: true,
        createdAt: true,
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
        number: true,
        title: true,
        author: true,
        status: true,
        createdAt: true,
        repository: { select: { fullName: true } },
        _count: { select: { reviewIssues: true } },
      },
    }),
  ]);
  const indexedRepos = allRepos.filter((r) => r.indexStatus === "indexed");
  const repoIds = indexedRepos.map((r) => r.id);

  // Build contextual query for embedding — include recent conversation for better RAG
  const recentHistory = conversation.messages.slice(-6); // last 3 Q&A pairs
  const contextualQuery = recentHistory.length > 0
    ? [...recentHistory.map((m) => `${m.role}: ${m.content}`), `user: ${message}`].join("\n")
    : message;
  // Truncate to avoid oversized embedding input (max ~8000 chars)
  const embeddingInput = contextualQuery.length > 8000
    ? contextualQuery.slice(-8000)
    : contextualQuery;

  const [queryVector] = await createEmbeddings([embeddingInput], {
    organizationId: orgId,
    operation: "embedding",
  });

  // Over-fetch from all 5 Qdrant collections in parallel (2x for reranking)
  const [rawCodeChunks, rawKnowledgeChunks, rawReviewChunks, rawChatChunks, rawDiagramChunks] = await Promise.all([
    repoIds.length > 0
      ? searchCodeChunksAcrossRepos(repoIds, queryVector, 30, embeddingInput)
      : Promise.resolve([]),
    searchKnowledgeChunks(orgId, queryVector, 16, embeddingInput),
    searchReviewChunks(orgId, queryVector, 10, embeddingInput),
    searchChatChunks(orgId, queryVector, 10, conversation.id, embeddingInput),
    searchDiagramChunks(orgId, queryVector, 6, embeddingInput),
  ]);

  // Combine all chunks with _source tag for unified reranking
  const allDocs = [
    ...rawCodeChunks.map((c) => ({ ...c, text: c.text, _source: "code" as const })),
    ...rawKnowledgeChunks.map((c) => ({ ...c, text: c.text, _source: "knowledge" as const })),
    ...rawReviewChunks.map((c) => ({ ...c, text: c.text, _source: "review" as const })),
    ...rawChatChunks.map((c) => ({ ...c, text: `Q: ${c.question}\nA: ${c.answer}`, _source: "chat" as const })),
    ...rawDiagramChunks.map((c) => ({ ...c, text: c.mermaidCode, _source: "diagram" as const })),
  ];

  const reranked = await rerankDocuments(message, allDocs, {
    topK: 25,
    scoreThreshold: 0.15,
    minResults: 5,
    organizationId: orgId,
    operation: "chat-rerank",
  });

  // Split reranked results back by source
  const codeChunks = reranked.filter((d) => d._source === "code") as (typeof rawCodeChunks[number] & { _source: "code" })[];
  const knowledgeChunks = reranked.filter((d) => d._source === "knowledge") as (typeof rawKnowledgeChunks[number] & { _source: "knowledge" })[];
  const reviewChunks = reranked.filter((d) => d._source === "review") as (typeof rawReviewChunks[number] & { _source: "review" })[];
  const chatChunks = reranked.filter((d) => d._source === "chat") as (typeof rawChatChunks[number] & { _source: "chat" })[];
  const diagramChunks = reranked.filter((d) => d._source === "diagram") as (typeof rawDiagramChunks[number] & { _source: "diagram" })[];

  console.log(`[chat] Reranked: ${reranked.length}/${allDocs.length} total — code:${codeChunks.length} knowledge:${knowledgeChunks.length} review:${reviewChunks.length} chat:${chatChunks.length} diagram:${diagramChunks.length}`);

  // Build context sections
  const repoMap = new Map(indexedRepos.map((r) => [r.id, r.fullName]));
  const codeContext = codeChunks
    .map(
      (c) =>
        `### ${repoMap.get(c.repoId) ?? "unknown"}/${c.filePath}:L${c.startLine}-L${c.endLine}\n\`\`\`\n${c.text}\n\`\`\``,
    )
    .join("\n\n");

  const knowledgeContext = knowledgeChunks
    .map((c) => `### ${c.title}\n${c.text}`)
    .join("\n\n");

  const reviewContext = reviewChunks
    .map(
      (c) =>
        `### ${c.repoFullName} PR #${c.prNumber}: ${c.prTitle} (by ${c.author}, ${c.reviewDate})\n${c.text}`,
    )
    .join("\n\n");

  const diagramContext = diagramChunks
    .map(
      (c) =>
        `### [${(c.diagramType ?? "flowchart").toUpperCase()}] ${c.repoFullName} PR #${c.prNumber}: ${c.prTitle} (by ${c.author}, ${c.reviewDate})\n\`\`\`mermaid\n${c.mermaidCode}\n\`\`\``,
    )
    .join("\n\n");

  const chatHistoryContext = chatChunks.length > 0
    ? chatChunks
        .map(
          (c) =>
            `### From: "${c.conversationTitle}"\n**Q:** ${c.question}\n**A:** ${c.answer}`,
        )
        .join("\n\n")
    : "";

  // Build rich context for system prompt
  const repoList = allRepos
    .map((r) => {
      const contributors = Array.isArray(r.contributors) ? r.contributors as { login: string; contributions: number }[] : [];
      const topContributors = contributors.slice(0, 10).map((c) => `${c.login} (${c.contributions})`).join(", ");
      const lines = [
        `### ${r.fullName}`,
        `- Provider: ${r.provider} | Branch: ${r.defaultBranch} | Auto-review: ${r.autoReview ? "on" : "off"}`,
        `- Index: ${r.indexStatus}${r.indexedAt ? ` (${r.indexedAt.toISOString().split("T")[0]})` : ""} | Files: ${r.indexedFiles}/${r.totalFiles} | Chunks: ${r.totalChunks}`,
        `- PRs: ${r._count.pullRequests} | Contributors: ${r.contributorCount}${topContributors ? ` — ${topContributors}` : ""}`,
      ];
      if (r.purpose) lines.push(`- Purpose: ${r.purpose}`);
      if (r.summary) lines.push(`- Summary: ${r.summary}`);
      if (r.analysis) lines.push(`- Analysis: ${r.analysis}`);
      return lines.join("\n");
    })
    .join("\n\n");

  const memberList = orgMembers
    .map((m) => `- ${m.user.name} (${m.user.email}) — ${m.role}`)
    .join("\n");

  const knowledgeList = knowledgeDocs.length > 0
    ? knowledgeDocs.map((d) => `- ${d.title} (${d.sourceType}, ${d.totalChunks} chunks)`).join("\n")
    : "No knowledge documents uploaded yet.";

  const prList = recentPRs.length > 0
    ? recentPRs
        .map(
          (pr) =>
            `- ${pr.repository.fullName}#${pr.number}: ${pr.title} (by ${pr.author}, ${pr.status}, ${pr._count.reviewIssues} issues) — ${pr.createdAt.toISOString().split("T")[0]}`,
        )
        .join("\n")
    : "No pull requests yet.";

  // Static instructions (cached across turns for the same user)
  const sharedNote = conversation.isShared
    ? "\nThis is a shared team conversation — multiple users may be participating."
    : "";
  const systemInstructions = `You are Octopus Chat, an AI assistant with deep knowledge of the user's codebase and organization.
You help developers understand their code, find patterns, debug issues, and answer questions.
The current user is: ${session.user.name} (${session.user.email})${sharedNote}

RULES:
- Answer questions about the organization, repositories, team, and code using ALL provided context
- Cite file paths: \`path/to/file.ts:L42\`
- Be concise and technical
- Use fenced code blocks with language tags
- If context is insufficient, say so honestly`;

  // Dynamic RAG context (changes each turn based on query)
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

  const isFirstMessage = conversation.messages.length === 0;
  const chatChannel = conversation.isShared ? `presence-chat-${conversation.id}` : null;

  // Stream response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send conversation ID first
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "conversation_id", id: conversation.id })}\n\n`,
          ),
        );

        // Broadcast stream start for shared chats
        if (chatChannel) {
          try {
            await pubby.trigger(chatChannel, "chat-stream-start", { conversationId: conversation.id });
          } catch {}
        }

        const client = getAnthropicClient();
        let fullResponse = "";
        let deltaBatch = "";
        let lastBroadcast = Date.now();

        const anthropicStream = client.messages.stream({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: [
            {
              type: "text" as const,
              text: systemInstructions,
              cache_control: { type: "ephemeral" as const },
            },
            {
              type: "text" as const,
              text: systemContext,
            },
          ],
          messages: historyMessages,
        });

        for await (const event of anthropicStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const text = event.delta.text;
            fullResponse += text;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "delta", text })}\n\n`,
              ),
            );

            // Broadcast deltas for shared chats (batched)
            if (chatChannel) {
              deltaBatch += text;
              if (deltaBatch.length >= 200 || Date.now() - lastBroadcast >= 500) {
                try {
                  await pubby.trigger(chatChannel, "chat-stream-delta", { text: deltaBatch });
                } catch {}
                deltaBatch = "";
                lastBroadcast = Date.now();
              }
            }
          }
        }

        // Flush remaining delta batch
        if (chatChannel && deltaBatch) {
          try {
            await pubby.trigger(chatChannel, "chat-stream-delta", { text: deltaBatch });
          } catch {}
        }

        // Log streaming chat usage
        const finalMessage = await anthropicStream.finalMessage();
        await logAiUsage({
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          operation: "chat",
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens,
          cacheReadTokens: finalMessage.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: finalMessage.usage.cache_creation_input_tokens ?? 0,
          organizationId: orgId,
        });

        // Save assistant response
        const savedAssistantMsg = await prisma.chatMessage.create({
          data: {
            role: "assistant",
            content: fullResponse,
            conversationId: conversation.id,
          },
        });

        // Broadcast completion for shared chats
        if (chatChannel) {
          try {
            await pubby.trigger(chatChannel, "chat-message-complete", {
              id: savedAssistantMsg.id,
              role: "assistant",
              content: fullResponse,
            });
          } catch {}

          // Mark queue entry as completed
          await prisma.chatQueue.updateMany({
            where: {
              conversationId: conversation.id,
              userId: session.user.id,
              status: "processing",
            },
            data: { status: "completed", completedAt: new Date() },
          });

          // Process next in queue (fire and forget)
          processNextInQueue(conversation.id).catch(() => {});
        }

        // Store Q&A pair in Qdrant for cross-conversation context
        if (fullResponse) {
          try {
            await ensureChatCollection();
            // Truncate for embedding (keep meaningful portion)
            const qaPairText = `Q: ${message}\nA: ${fullResponse}`.slice(0, 8000);
            const [qaVector] = await createEmbeddings([qaPairText], {
              organizationId: orgId,
              operation: "embedding",
            });
            const conv = await prisma.chatConversation.findUnique({
              where: { id: conversation.id },
              select: { title: true },
            });
            await upsertChatChunk({
              id: crypto.randomUUID(),
              vector: qaVector,
              sparseVector: generateSparseVector(qaPairText),
              payload: {
                orgId,
                userId: session.user.id,
                conversationId: conversation.id,
                conversationTitle: conv?.title ?? "New Chat",
                question: message,
                answer: fullResponse.slice(0, 4000), // keep payload reasonable
                createdAt: new Date().toISOString(),
              },
            });
          } catch {
            // Non-critical — don't break the response
          }
        }

        // Auto-generate title on first message
        if (isFirstMessage && fullResponse) {
          try {
            const titleResponse = await client.messages.create({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 50,
              messages: [
                {
                  role: "user",
                  content: `Generate a very short title (max 6 words) summarizing the TOPIC of this developer question. Keep the same language as the question. Do NOT mention the language itself. Reply ONLY with the title, nothing else.\n\nQuestion: "${message}"`,
                },
              ],
            });
            const title =
              titleResponse.content[0].type === "text"
                ? titleResponse.content[0].text.trim()
                : "New Chat";
            await logAiUsage({
              provider: "anthropic",
              model: "claude-haiku-4-5-20251001",
              operation: "chat-title",
              inputTokens: titleResponse.usage.input_tokens,
              outputTokens: titleResponse.usage.output_tokens,
              cacheReadTokens: titleResponse.usage.cache_read_input_tokens ?? 0,
              cacheWriteTokens: titleResponse.usage.cache_creation_input_tokens ?? 0,
              organizationId: orgId,
            });
            await prisma.chatConversation.update({
              where: { id: conversation.id },
              data: { title },
            });
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "title", title })}\n\n`,
              ),
            );

            // Broadcast title update for shared chats
            if (chatChannel) {
              try {
                await pubby.trigger(chatChannel, "chat-title-update", { title });
              } catch {}
            }
          } catch {}
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        console.error("[chat] streaming error:", err);
        // Mark queue entry as failed for shared chats
        if (conversation.isShared) {
          await prisma.chatQueue.updateMany({
            where: {
              conversationId: conversation.id,
              userId: session.user.id,
              status: "processing",
            },
            data: { status: "failed", completedAt: new Date() },
          }).catch(() => {});

          // Try to process next in queue
          processNextInQueue(conversation.id).catch(() => {});
        }

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: "Stream error" })}\n\n`,
          ),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
