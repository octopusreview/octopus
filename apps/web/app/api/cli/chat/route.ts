import { authenticateApiToken } from "@/lib/api-auth";
import { prisma } from "@octopus/db";
import { createEmbeddings } from "@/lib/embeddings";
import {
  searchCodeChunksAcrossRepos,
  searchKnowledgeChunks,
  searchReviewChunks,
} from "@/lib/qdrant";
import { logAiUsage } from "@/lib/ai-usage";
import { rerankDocuments } from "@/lib/reranker";
import Anthropic from "@anthropic-ai/sdk";
import { requestAgentSearch } from "@/lib/agent-search";
import { getReviewModel } from "@/lib/ai-client";
import { buildCliChatSystemPrompt } from "@/lib/cli-chat-prompt";
import { streamChat } from "@/lib/chat-stream";
import { getOrgSpendLimitStatus } from "@/lib/cost";
import {
  chatScopeGuardEnabled,
  checkChatScope,
  checkFreeChatDailyCap,
  dailyCapMessage,
  OUT_OF_SCOPE_MESSAGE,
} from "@/lib/chat-guard";

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return anthropicClient;
}

export async function POST(request: Request) {
  const result = await authenticateApiToken(request);
  if (!result) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { message, conversationId, repoId } = await request.json();
  if (!message) {
    return Response.json({ error: "Missing message" }, { status: 400 });
  }

  const orgId = result.org.id;

  // Spend-limit gate — reject before any AI calls or conversation state
  // changes. Mirrors the gate in /api/chat and lib/chat-queue-processor.
  const spendStatus = await getOrgSpendLimitStatus(orgId);
  if (spendStatus.blocked) {
    const limitMsg =
      spendStatus.reason === "no_credits"
        ? "Your organization is out of credits. Top up in Settings or add your own API keys to continue."
        : "Your organization has reached its monthly AI usage limit. Increase the limit or add your own API keys in Settings to continue.";
    console.warn(`[chat-cli] Org ${orgId} over spend limit (${spendStatus.reason}) — rejecting chat`);
    return Response.json(
      { blocked: true, reason: spendStatus.reason, message: limitMsg },
      { status: 402 },
    );
  }

  // Abuse gates (lib/chat-guard.ts) — mirrors /api/chat.
  const dailyCap = await checkFreeChatDailyCap(orgId);
  if (dailyCap.blocked) {
    console.warn(`[chat-cli] Org ${orgId} rejected (daily_cap)`);
    return Response.json(
      { blocked: true, reason: "daily_cap", message: dailyCapMessage(dailyCap.capUsd) },
      { status: 402 },
    );
  }
  if (chatScopeGuardEnabled()) {
    const inScope = await checkChatScope(getAnthropicClient(), message, orgId);
    if (!inScope) {
      console.warn(`[chat-cli] Org ${orgId} rejected (out_of_scope)`);
      return Response.json(
        { blocked: true, reason: "out_of_scope", message: OUT_OF_SCOPE_MESSAGE },
        { status: 402 },
      );
    }
  }

  // Get or create conversation
  let conversation;
  if (conversationId) {
    conversation = await prisma.chatConversation.findFirst({
      where: { id: conversationId, organizationId: orgId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conversation) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }
  } else {
    conversation = await prisma.chatConversation.create({
      data: { userId: result.user.id, organizationId: orgId },
      include: { messages: true },
    });
  }

  // Save user message
  await prisma.chatMessage.create({
    data: {
      role: "user",
      content: message,
      conversationId: conversation.id,
      userId: result.user.id,
      userName: result.user.name,
    },
  });

  // Build conversation history
  const historyMessages = conversation.messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
  historyMessages.push({ role: "user", content: message });

  // Get repos for RAG
  const repoFilter = repoId
    ? { id: repoId, organizationId: orgId, isActive: true }
    : { organizationId: orgId, isActive: true, indexStatus: "indexed" as const };

  const indexedRepos = await prisma.repository.findMany({
    where: repoFilter,
    select: { id: true, fullName: true },
  });
  const repoIds = indexedRepos.map((r) => r.id);

  // Build contextual query — fetch only last 6 messages for efficiency
  const recentHistory = await prisma.chatMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { role: true, content: true },
  });
  recentHistory.reverse();
  const contextualQuery = recentHistory.length > 0
    ? [...recentHistory.map((m) => `${m.role}: ${m.content}`), `user: ${message}`].join("\n")
    : message;
  const embeddingInput = contextualQuery.length > 8000
    ? contextualQuery.slice(-8000)
    : contextualQuery;

  const [queryVector] = await createEmbeddings([embeddingInput], {
    organizationId: orgId,
    operation: "embedding",
  });

  // Search relevant chunks + local agent search in parallel
  const [rawCodeChunks, rawKnowledgeChunks, rawReviewChunks, agentResult] = await Promise.all([
    repoIds.length > 0
      ? searchCodeChunksAcrossRepos(repoIds, queryVector, 20, embeddingInput)
      : Promise.resolve([]),
    searchKnowledgeChunks(orgId, queryVector, 10, embeddingInput),
    searchReviewChunks(orgId, queryVector, 6, embeddingInput),
    requestAgentSearch({
      orgId,
      query: message,
      conversationId: conversation.id,
    }),
  ]);

  // Combine and rerank
  const allDocs = [
    ...rawCodeChunks.map((c) => ({ ...c, text: c.text, _source: "code" as const })),
    ...rawKnowledgeChunks.map((c) => ({ ...c, text: c.text, _source: "knowledge" as const })),
    ...rawReviewChunks.map((c) => ({ ...c, text: c.text, _source: "review" as const })),
  ];

  const reranked = await rerankDocuments(message, allDocs, {
    topK: 15,
    scoreThreshold: 0.15,
    minResults: 3,
    organizationId: orgId,
    operation: "chat-rerank",
  });

  const codeChunks = reranked.filter((d) => d._source === "code") as (typeof rawCodeChunks[number] & { _source: "code" })[];
  const knowledgeChunks = reranked.filter((d) => d._source === "knowledge") as (typeof rawKnowledgeChunks[number] & { _source: "knowledge" })[];
  const reviewChunks = reranked.filter((d) => d._source === "review") as (typeof rawReviewChunks[number] & { _source: "review" })[];

  const repoMap = new Map(indexedRepos.map((r) => [r.id, r.fullName]));
  const codeContext = codeChunks
    .map((c) => `### ${repoMap.get(c.repoId) ?? "unknown"}/${c.filePath}:L${c.startLine}-L${c.endLine}\n\`\`\`\n${c.text}\n\`\`\``)
    .join("\n\n");

  const knowledgeContext = knowledgeChunks
    .map((c) => `### ${c.title}\n${c.text}`)
    .join("\n\n");

  const reviewContext = reviewChunks
    .map((c) => `### ${c.repoFullName} PR #${c.prNumber}: ${c.prTitle} (by ${c.author}, ${c.reviewDate})\n${c.text}`)
    .join("\n\n");

  const systemPrompt = buildCliChatSystemPrompt({
    userName: result.user.name,
    userEmail: result.user.email,
    codeContext,
    knowledgeContext,
    reviewContext,
    agentResult,
  });

  // Stream response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "conversation_id", id: conversation.id })}\n\n`),
        );

        let fullResponse = "";

        const chatModel = await getReviewModel(orgId, repoId);

        const result = await streamChat({
          orgId,
          model: chatModel,
          system: systemPrompt,
          messages: historyMessages,
          maxTokens: 4096,
          onDelta: (text) => {
            fullResponse += text;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "delta", text })}\n\n`),
            );
          },
        });

        await logAiUsage({
          provider: result.provider,
          model: chatModel,
          operation: "chat",
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cacheReadTokens: result.usage.cacheReadTokens,
          cacheWriteTokens: result.usage.cacheWriteTokens,
          organizationId: orgId,
        });

        await prisma.chatMessage.create({
          data: {
            role: "assistant",
            content: fullResponse,
            conversationId: conversation.id,
          },
        });

        // Auto-generate title on first message
        if (conversation.messages.length === 0 && fullResponse) {
          try {
            const titleResponse = await getAnthropicClient().messages.create({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 50,
              messages: [
                {
                  role: "user",
                  content: `Generate a very short title (max 6 words) for this question. Same language as the question. Reply ONLY with the title.\n\nQuestion: "${message}"`,
                },
              ],
            });
            const title = titleResponse.content[0].type === "text"
              ? titleResponse.content[0].text.trim()
              : "CLI Chat";
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
              encoder.encode(`data: ${JSON.stringify({ type: "title", title })}\n\n`),
            );
          } catch {}
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        console.error("[cli-chat] Stream error:", err);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", message: "An error occurred while processing your request" })}\n\n`),
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
