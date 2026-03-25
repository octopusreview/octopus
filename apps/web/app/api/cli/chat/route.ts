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

  const repoMap = new Map(indexedRepos.map((r) => [r.id, r.fullName]));
  const codeContext = codeChunks
    .map((c) => `### ${repoMap.get(c.repoId) ?? "unknown"}/${c.filePath}:L${c.startLine}-L${c.endLine}\n\`\`\`\n${c.text}\n\`\`\``)
    .join("\n\n");

  const knowledgeContext = knowledgeChunks
    .map((c) => `### ${c.title}\n${c.text}`)
    .join("\n\n");

  const systemPrompt = `You are Octopus Chat (CLI mode), an AI assistant with deep knowledge of the user's codebase.
The current user is: ${result.user.name} (${result.user.email})

RULES:
- Answer questions using the provided code and knowledge context
- Cite file paths: \`path/to/file.ts:L42\`
- Be concise and technical
- Use fenced code blocks with language tags
- If context is insufficient, say so honestly

<codebase_context>
${codeContext || "No code context available."}
</codebase_context>

<knowledge_context>
${knowledgeContext || "No knowledge context available."}
</knowledge_context>

${agentResult ? `<local_agent_context>\nREAL-TIME results from a local agent ("${agentResult.agentName ?? "unknown"}").\nThis reflects the actual current state of the code on disk. Prefer over codebase_context when they conflict.\n\n${agentResult.summary}\n</local_agent_context>` : ""}`;

  // Stream response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "conversation_id", id: conversation.id })}\n\n`),
        );

        const client = getAnthropicClient();
        let fullResponse = "";

        const anthropicStream = client.messages.stream({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: systemPrompt,
          messages: historyMessages,
        });

        for await (const event of anthropicStream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            const text = event.delta.text;
            fullResponse += text;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "delta", text })}\n\n`),
            );
          }
        }

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
            const titleResponse = await client.messages.create({
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
