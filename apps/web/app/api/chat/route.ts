import { headers } from "next/headers";
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
import { requestAgentSearch, findClaudeAgent, requestAgentAnswer } from "@/lib/agent-search";
import { getReviewModel } from "@/lib/ai-client";
import { getAnthropicClient, getOpenAIClient, modelForGateway } from "@/lib/ai-router";

async function translateToEnglish(text: string): Promise<string> {
  // Skip translation for ASCII-only and Latin-extended text (accented chars like é, ñ, ü).
  // Only translate when non-Latin scripts are detected (Cyrillic, CJK, Arabic, Turkish İ/ı, etc.)
  const hasNonLatinScript = /[^\u0000-\u024F\u1E00-\u1EFF]/.test(text);
  if (!hasNonLatinScript) return text;

  try {
    const res = await getOpenAIClient().chat.completions.create({
      // databricks-gpt-5-mini routes through AI Gateway when on Databricks;
      // otherwise the SDK uses the local OpenAI baseURL + key.
      model: process.env.DATABRICKS_HOST ? "databricks-gpt-5-mini" : "gpt-4o-mini",
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content:
            "If the following text is already in English, return it as-is. Otherwise translate it to English. Return ONLY the translated text, nothing else.",
        },
        { role: "user", content: text },
      ],
    });
    return res.choices[0]?.message?.content?.trim() || text;
  } catch {
    return text;
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { message, conversationId, orgId, repoContext } = await request.json();
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

  // Build conversation history for Claude — keep last 40 messages to stay within token budget
  const MAX_HISTORY_MESSAGES = 40;
  const MAX_MESSAGE_LENGTH = 6000;
  const recentMessages = conversation.messages.slice(-MAX_HISTORY_MESSAGES);
  const historyMessages = recentMessages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content.length > MAX_MESSAGE_LENGTH
      ? m.content.slice(0, MAX_MESSAGE_LENGTH) + "\n[...truncated]"
      : m.content,
  }));
  historyMessages.push({ role: "user", content: message });

  // Lightweight org data — only what's needed for RAG routing and minimal context
  const [allRepos, orgMembers] = await Promise.all([
    prisma.repository.findMany({
      where: { organizationId: orgId, isActive: true },
      select: {
        id: true,
        fullName: true,
        name: true,
        provider: true,
        indexStatus: true,
      },
    }),
    prisma.organizationMember.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: { role: true, user: { select: { name: true, email: true } } },
    }),
  ]);
  const indexedRepos = allRepos.filter((r) => r.indexStatus === "indexed");
  const repoIds = indexedRepos.map((r) => r.id);

  // Detect if user is asking about a specific repo — check current message + recent history + explicit repo context
  const messageLower = message.toLowerCase();
  const recentHistoryText = conversation.messages.slice(-10).map((m) => m.content).join(" ").toLowerCase();
  const repoContextLower = repoContext ? repoContext.toLowerCase() : "";
  const searchText = `${messageLower} ${recentHistoryText} ${repoContextLower}`;
  const mentionedRepos = indexedRepos.filter((r) => {
    const name = r.name.toLowerCase();
    const fullName = r.fullName.toLowerCase();
    return searchText.includes(name) || searchText.includes(fullName);
  });

  // Fetch full details for mentioned repos
  let mentionedRepoContext = "";
  if (mentionedRepos.length > 0) {
    const repoDetails = await prisma.repository.findMany({
      where: { id: { in: mentionedRepos.map((r) => r.id) } },
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
        _count: { select: { pullRequests: true } },
      },
    });
    mentionedRepoContext = repoDetails.map((r) => {
      const contributors = Array.isArray(r.contributors) ? (r.contributors as { login: string; contributions: number }[]) : [];
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
    }).join("\n\n");
    console.log(`[chat] Detected mentioned repos: ${mentionedRepos.map((r) => r.fullName).join(", ")}`);
  }

  // Translate user message to English for keyword detection (handles any language)
  const englishMessage = await translateToEnglish(message);
  const englishSearchText = `${englishMessage.toLowerCase()} ${recentHistoryText} ${repoContextLower}`;

  // Detect PR/activity related questions — fetch recent PRs for mentioned repos (or all if no repo mentioned)
  const prKeywords = /\b(pr|pull request|merge|commit|deploy|release|recent|latest|last|activity)\b/i;
  let recentPRsContext = "";
  if (prKeywords.test(englishSearchText)) {
    const prRepoFilter = mentionedRepos.length > 0
      ? { repositoryId: { in: mentionedRepos.map((r) => r.id) } }
      : { repository: { organizationId: orgId } };
    const recentPRs = await prisma.pullRequest.findMany({
      where: prRepoFilter,
      orderBy: { createdAt: "desc" },
      take: 15,
      select: {
        number: true,
        title: true,
        author: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        repository: { select: { fullName: true } },
        _count: { select: { reviewIssues: true } },
      },
    });
    if (recentPRs.length > 0) {
      recentPRsContext = recentPRs
        .map(
          (pr) =>
            `- ${pr.repository.fullName}#${pr.number}: "${pr.title}" by ${pr.author} (${pr.status}) — created: ${pr.createdAt.toISOString().split("T")[0]}, updated: ${pr.updatedAt.toISOString().split("T")[0]}, issues: ${pr._count.reviewIssues}`,
        )
        .join("\n");
      console.log(`[chat] Fetched ${recentPRs.length} recent PRs for context`);
    }
  }

  // Detect issue/bug related questions — fetch review issues for mentioned repos
  const issueKeywords = /\b(issue|bug|problem|finding|security|critical|severity|vulnerability|error)\b/i;
  let reviewIssuesContext = "";
  if (issueKeywords.test(englishSearchText)) {
    const issueRepoFilter = mentionedRepos.length > 0
      ? { pullRequest: { repositoryId: { in: mentionedRepos.map((r) => r.id) } } }
      : { pullRequest: { repository: { organizationId: orgId } } };
    const recentIssues = await prisma.reviewIssue.findMany({
      where: issueRepoFilter,
      orderBy: { createdAt: "desc" },
      take: 15,
      include: {
        pullRequest: {
          select: {
            number: true,
            title: true,
            repository: { select: { fullName: true } },
          },
        },
      },
    });
    if (recentIssues.length > 0) {
      reviewIssuesContext = recentIssues
        .map(
          (i) =>
            `- [${i.severity}] ${i.pullRequest.repository.fullName}#${i.pullRequest.number} — ${i.title}${i.filePath ? ` (${i.filePath})` : ""} — ${i.feedback ?? "no feedback"} — ${i.createdAt.toISOString().split("T")[0]}\n  ${i.description?.slice(0, 200) ?? ""}`,
        )
        .join("\n");
      console.log(`[chat] Fetched ${recentIssues.length} review issues for context`);
    }
  }

  // Detect team/contributor related questions
  const teamKeywords = /\b(who|contributor|team|developer|author|member|work|engineer)\b/i;
  let contributorContext = "";
  if (teamKeywords.test(englishSearchText) && mentionedRepos.length > 0) {
    const repoDetails = await prisma.repository.findMany({
      where: { id: { in: mentionedRepos.map((r) => r.id) } },
      select: { fullName: true, contributors: true, contributorCount: true },
    });
    contributorContext = repoDetails
      .map((r) => {
        const contributors = Array.isArray(r.contributors) ? (r.contributors as { login: string; contributions: number }[]) : [];
        return `### ${r.fullName} (${r.contributorCount} contributors)\n${contributors.map((c) => `- ${c.login}: ${c.contributions} contributions`).join("\n")}`;
      })
      .join("\n\n");
  }

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
  // If specific repos are mentioned, also fetch targeted chunks from those repos
  // Also run local agent search in parallel if agents are online
  const mentionedRepoIds = mentionedRepos.map((r) => r.id);

  const [rawCodeChunks, rawTargetedCodeChunks, rawKnowledgeChunks, rawReviewChunks, rawChatChunks, rawDiagramChunks, agentResult] = await Promise.all([
    repoIds.length > 0
      ? searchCodeChunksAcrossRepos(repoIds, queryVector, 30, embeddingInput)
      : Promise.resolve([]),
    mentionedRepoIds.length > 0
      ? searchCodeChunksAcrossRepos(mentionedRepoIds, queryVector, 20, embeddingInput)
      : Promise.resolve([]),
    searchKnowledgeChunks(orgId, queryVector, 16, embeddingInput),
    searchReviewChunks(orgId, queryVector, 10, embeddingInput),
    searchChatChunks(orgId, queryVector, 10, conversation.id, embeddingInput),
    searchDiagramChunks(orgId, queryVector, 6, embeddingInput),
    requestAgentSearch({
      orgId,
      query: message,
      conversationId: conversation.id,
    }),
  ]);

  const agentUsed = agentResult !== null;
  if (agentUsed) {
    console.log(`[chat] Local agent "${agentResult.agentName}" returned results for task ${agentResult.taskId}`);
  }

  // Merge and deduplicate code chunks — targeted repo chunks get priority
  const seenChunkKeys = new Set<string>();
  const mergedCodeChunks = [...rawTargetedCodeChunks, ...rawCodeChunks].filter((c) => {
    const key = `${c.repoId}:${c.filePath}:${c.startLine}`;
    if (seenChunkKeys.has(key)) return false;
    seenChunkKeys.add(key);
    return true;
  });

  // Combine all chunks with _source tag for unified reranking
  const allDocs = [
    ...mergedCodeChunks.map((c) => ({ ...c, text: c.text, _source: "code" as const })),
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

  // Build context sections with per-chunk truncation
  const MAX_CHUNK_LENGTH = 3000;
  const repoMap = new Map(indexedRepos.map((r) => [r.id, r.fullName]));
  const codeContext = codeChunks
    .map(
      (c) =>
        `### ${repoMap.get(c.repoId) ?? "unknown"}/${c.filePath}:L${c.startLine}-L${c.endLine}\n\`\`\`\n${c.text.slice(0, MAX_CHUNK_LENGTH)}\n\`\`\``,
    )
    .join("\n\n");

  const knowledgeContext = knowledgeChunks
    .map((c) => `### ${c.title}\n${c.text.slice(0, MAX_CHUNK_LENGTH)}`)
    .join("\n\n");

  const reviewContext = reviewChunks
    .map(
      (c) =>
        `### ${c.repoFullName} PR #${c.prNumber}: ${c.prTitle} (by ${c.author}, ${c.reviewDate})\n${c.text.slice(0, MAX_CHUNK_LENGTH)}`,
    )
    .join("\n\n");

  const diagramContext = diagramChunks
    .map(
      (c) =>
        `### [${(c.diagramType ?? "flowchart").toUpperCase()}] ${c.repoFullName} PR #${c.prNumber}: ${c.prTitle} (by ${c.author}, ${c.reviewDate})\n\`\`\`mermaid\n${c.mermaidCode.slice(0, MAX_CHUNK_LENGTH)}\n\`\`\``,
    )
    .join("\n\n");

  const chatHistoryContext = chatChunks.length > 0
    ? chatChunks
        .map(
          (c) =>
            `### From: "${c.conversationTitle}"\n**Q:** ${c.question.slice(0, 1000)}\n**A:** ${c.answer.slice(0, 2000)}`,
        )
        .join("\n\n")
    : "";

  // Minimal static context — repo names and team only, everything else comes from RAG
  const repoList = allRepos
    .map((r) => `- ${r.fullName} (${r.provider}, ${r.indexStatus})`)
    .join("\n");

  const memberList = orgMembers
    .map((m) => `- ${m.user.name} (${m.user.email}) — ${m.role}`)
    .join("\n");

  // Static instructions (cached across turns for the same user)
  const sharedNote = conversation.isShared
    ? "\nThis is a shared team conversation — multiple users may be participating."
    : "";
  const systemInstructions = `You are Octopus Chat, an AI assistant with deep knowledge of the user's codebase and organization.
You help developers understand their code, find patterns, debug issues, and answer questions.
The current user is: ${session.user.name} (${session.user.email})${sharedNote}

RULES:
- Answer questions using ONLY the provided context sections below
- The context is dynamically retrieved based on the user's query:
  - codebase_context: source code from indexed repositories (via semantic search)
  - mentioned_repository_details: full info about repos the user asked about
  - recent_pull_requests: live PR data from the database (when the user asks about PRs, activity, merges)
  - review_issues: code review findings and bugs (when the user asks about issues, bugs, security)
  - contributors: contributor details (when the user asks about who works on what)
  - local_agent_context: REAL-TIME search results from a local agent on a developer machine — most up-to-date source, prefer over codebase_context when they conflict
  - knowledge_context, review_context, diagram_context, previous_conversations: RAG results
- Cite file paths: \`path/to/file.ts:L42\`
- Be concise and technical
- Use fenced code blocks with language tags
- If no relevant context was retrieved for a question, say "I couldn't find relevant code for this query. Try rephrasing or being more specific." Do NOT make up or guess code, endpoints, or file structures.
- NEVER say "I don't have access to the code" — you DO have access via the retrieved context. If context is empty, the search simply didn't match.
- For PR/activity questions, use the recent_pull_requests section which contains LIVE data from the database — this is always up to date.
- Respond in the language of the USER'S LATEST message only. Ignore the language of prior messages, retrieved context, or repository content when deciding output language. If the latest user message is in English, respond in English even if earlier messages were in another language.${repoContext ? `\n- IMPORTANT: This conversation is specifically about the **${repoContext}** repository. Focus all answers on this repository unless the user explicitly asks about something else. When the user says "this", "it", "the repo", etc., they mean ${repoContext}.` : ""}`;

  // Dynamic RAG context — only relevant retrieved content, minimal static info
  const systemContext = `<organization_overview>
## Team (${orgMembers.length} members)
${memberList}

## Repositories (${allRepos.length})
${repoList || "No repositories connected yet."}
</organization_overview>

${mentionedRepoContext ? `<mentioned_repository_details>\n${mentionedRepoContext}\n</mentioned_repository_details>` : ""}

${recentPRsContext ? `<recent_pull_requests>\n${recentPRsContext}\n</recent_pull_requests>` : ""}

${reviewIssuesContext ? `<review_issues>\n${reviewIssuesContext}\n</review_issues>` : ""}

${contributorContext ? `<contributors>\n${contributorContext}\n</contributors>` : ""}

${codeContext ? `<codebase_context>\n${codeContext}\n</codebase_context>` : ""}

${knowledgeContext ? `<knowledge_context>\n${knowledgeContext}\n</knowledge_context>` : ""}

${reviewContext ? `<review_context>\n${reviewContext}\n</review_context>` : ""}

${diagramContext ? `<diagram_context>\n${diagramContext}\n</diagram_context>` : ""}

${chatHistoryContext ? `<previous_conversations>\n${chatHistoryContext}\n</previous_conversations>` : ""}

${agentResult ? `<local_agent_context>\nREAL-TIME results from a local agent running on a developer machine ("${agentResult.agentName ?? "unknown"}").\nThis reflects the actual current state of the code on disk. Prefer this over codebase_context when they conflict.\n\n${agentResult.summary}\n</local_agent_context>` : ""}`;

  // Safety net: trim context if it still exceeds token budget (~4 chars per token)
  const MAX_CONTEXT_CHARS = 140_000 * 4; // ~560K chars ≈ 140K tokens
  let finalSystemContext = systemContext;
  if (finalSystemContext.length > MAX_CONTEXT_CHARS) {
    // Truncate from the end — least relevant RAG sections get cut
    finalSystemContext = finalSystemContext.slice(0, MAX_CONTEXT_CHARS);
    console.log(`[chat] Context trimmed: ${systemContext.length} -> ${finalSystemContext.length} chars`);
  }

  const isFirstMessage = conversation.messages.length === 0;
  const chatChannel = conversation.isShared ? `presence-chat-${conversation.id}` : null;

  // --- Agent answer path: delegate to local agent with claude-cli ---
  const claudeAgent = await findClaudeAgent(orgId);
  if (claudeAgent) {
    const agentRepos = claudeAgent.repoFullNames as string[];
    const targetRepo = mentionedRepos.find((r) => agentRepos.includes(r.fullName))?.fullName
      ?? agentRepos[0];

    if (targetRepo) {
      console.log(`[chat] Delegating answer to agent "${claudeAgent.name}" via repo "${targetRepo}"`);

      const agentAnswer = await requestAgentAnswer({
        orgId,
        systemPrompt: systemInstructions,
        contextSections: finalSystemContext,
        conversationHistory: historyMessages,
        conversationId: conversation.id,
        repoFullName: targetRepo,
      });

      if (agentAnswer) {
        return streamAgentAnswer({
          answer: agentAnswer.answer,
          agentName: agentAnswer.agentName,
          conversationId: conversation.id,
          message,
          orgId,
          userId: session.user.id,
          isFirstMessage,
          chatChannel,
          isShared: conversation.isShared ?? false,
        });
      }

      console.log("[chat] Agent answer failed/timed out, falling back to server LLM");
    }
  }

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

        // Send agent search status
        if (agentUsed) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "agent_used", agentName: agentResult?.agentName })}\n\n`,
            ),
          );
        }

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

        let chatRepoId: string | undefined;
        if (repoContext) {
          const repo = await prisma.repository.findFirst({
            where: { fullName: repoContext, organizationId: orgId },
            select: { id: true },
          });
          chatRepoId = repo?.id;
        }
        const chatModel = await getReviewModel(orgId, chatRepoId);
        const wireChatModel = modelForGateway(chatModel, "anthropic");

        const anthropicStream = client.messages.stream({
          model: wireChatModel,
          max_tokens: 4096,
          system: [
            {
              type: "text" as const,
              text: systemInstructions,
              cache_control: { type: "ephemeral" as const },
            },
            {
              type: "text" as const,
              text: finalSystemContext,
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
        const inputTokens = finalMessage.usage.input_tokens;
        const outputTokens = finalMessage.usage.output_tokens;
        const cacheRead = finalMessage.usage.cache_read_input_tokens ?? 0;
        const cacheWrite = finalMessage.usage.cache_creation_input_tokens ?? 0;
        const totalTokens = inputTokens + outputTokens;
        const maxTokens = 200_000;
        const remainingTokens = maxTokens - inputTokens;

        await logAiUsage({
          provider: "anthropic",
          model: chatModel,
          operation: "chat",
          inputTokens,
          outputTokens,
          cacheReadTokens: cacheRead,
          cacheWriteTokens: cacheWrite,
          organizationId: orgId,
        });

        // Send token usage info to client
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "usage",
              inputTokens,
              outputTokens,
              cacheReadTokens: cacheRead,
              cacheWriteTokens: cacheWrite,
              totalTokens,
              maxContextTokens: maxTokens,
              remainingTokens,
            })}\n\n`,
          ),
        );

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
              model: modelForGateway("claude-haiku-4-5-20251001", "anthropic"),
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
              model: modelForGateway("claude-haiku-4-5-20251001", "anthropic"),
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
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Stream an agent-generated answer to the client.
 * No server-side LLM cost — the answer was generated locally by the agent.
 */
async function streamAgentAnswer(opts: {
  answer: string;
  agentName: string | null;
  conversationId: string;
  message: string;
  orgId: string;
  userId: string;
  isFirstMessage: boolean;
  chatChannel: string | null;
  isShared: boolean;
}): Promise<Response> {
  const { answer, agentName, conversationId, message, orgId, userId, isFirstMessage, chatChannel } = opts;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send conversation ID
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "conversation_id", id: conversationId })}\n\n`,
          ),
        );

        // Signal that the agent generated the full answer
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "agent_answered", agentName })}\n\n`,
          ),
        );

        // Broadcast stream start for shared chats
        if (chatChannel) {
          try {
            await pubby.trigger(chatChannel, "chat-stream-start", { conversationId });
          } catch {}
        }

        // Stream the answer in chunks for a natural UX
        const CHUNK_SIZE = 100;
        let deltaBatch = "";
        let lastBroadcast = Date.now();

        for (let i = 0; i < answer.length; i += CHUNK_SIZE) {
          const chunk = answer.slice(i, i + CHUNK_SIZE);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "delta", text: chunk })}\n\n`,
            ),
          );

          // Broadcast deltas for shared chats (batched)
          if (chatChannel) {
            deltaBatch += chunk;
            if (deltaBatch.length >= 200 || Date.now() - lastBroadcast >= 500) {
              try {
                await pubby.trigger(chatChannel, "chat-stream-delta", { text: deltaBatch });
              } catch {}
              deltaBatch = "";
              lastBroadcast = Date.now();
            }
          }

          // Small delay between chunks for streaming feel
          if (i + CHUNK_SIZE < answer.length) {
            await new Promise((r) => setTimeout(r, 5));
          }
        }

        // Flush remaining delta batch
        if (chatChannel && deltaBatch) {
          try {
            await pubby.trigger(chatChannel, "chat-stream-delta", { text: deltaBatch });
          } catch {}
        }

        // Send zero usage — no server LLM cost
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "usage",
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              totalTokens: 0,
              maxContextTokens: 200_000,
              remainingTokens: 200_000,
            })}\n\n`,
          ),
        );

        // Save assistant response (user message already saved at the top of POST handler)
        const savedAssistantMsg = await prisma.chatMessage.create({
          data: {
            role: "assistant",
            content: answer,
            conversationId,
          },
        });

        // Broadcast completion for shared chats
        if (chatChannel) {
          try {
            await pubby.trigger(chatChannel, "chat-message-complete", {
              id: savedAssistantMsg.id,
              role: "assistant",
              content: answer,
            });
          } catch {}

          await prisma.chatQueue.updateMany({
            where: {
              conversationId,
              userId,
              status: "processing",
            },
            data: { status: "completed", completedAt: new Date() },
          });

          processNextInQueue(conversationId).catch(() => {});
        }

        // Store Q&A in Qdrant for cross-conversation context
        try {
          await ensureChatCollection();
          const qaPairText = `Q: ${message}\nA: ${answer}`.slice(0, 8000);
          const [qaVector] = await createEmbeddings([qaPairText], {
            organizationId: orgId,
            operation: "embedding",
          });
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
              userId,
              conversationId,
              conversationTitle: conv?.title ?? "New Chat",
              question: message,
              answer: answer.slice(0, 4000),
              createdAt: new Date().toISOString(),
            },
          });
        } catch {
          // Non-critical
        }

        // Auto-generate title on first message
        if (isFirstMessage) {
          try {
            const client = getAnthropicClient();
            const titleResponse = await client.messages.create({
              model: modelForGateway("claude-haiku-4-5-20251001", "anthropic"),
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
              model: modelForGateway("claude-haiku-4-5-20251001", "anthropic"),
              operation: "chat-title",
              inputTokens: titleResponse.usage.input_tokens,
              outputTokens: titleResponse.usage.output_tokens,
              cacheReadTokens: titleResponse.usage.cache_read_input_tokens ?? 0,
              cacheWriteTokens: titleResponse.usage.cache_creation_input_tokens ?? 0,
              organizationId: orgId,
            });
            await prisma.chatConversation.update({
              where: { id: conversationId },
              data: { title },
            });
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "title", title })}\n\n`,
              ),
            );

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
        console.error("[chat] agent answer streaming error:", err);

        if (opts.isShared) {
          await prisma.chatQueue.updateMany({
            where: { conversationId, userId, status: "processing" },
            data: { status: "failed", completedAt: new Date() },
          }).catch(() => {});
          processNextInQueue(conversationId).catch(() => {});
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
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
