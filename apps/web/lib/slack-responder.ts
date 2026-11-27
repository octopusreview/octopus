import Anthropic from "@anthropic-ai/sdk";
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
import { HARDCODED_REVIEW_MODEL } from "@/lib/ai-client";
import { generateSparseVector } from "@/lib/sparse-vector";

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return anthropicClient;
}

type SlackQuestionParams = {
  question: string;
  orgId: string;
  responseUrl: string;
  userName: string;
  slackUserId: string;
};

export async function processSlackQuestion({
  question,
  orgId,
  responseUrl,
  userName,
  slackUserId,
}: SlackQuestionParams): Promise<void> {
  try {
    console.log(`[slack-responder] Processing question for org ${orgId}: "${question}"`);

    // 1. Fetch DB context (same pattern as chat route)
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
        take: 10,
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

    // 2. Create embedding for the question
    const [queryVector] = await createEmbeddings([question], {
      organizationId: orgId,
      operation: "slack-command-embedding",
    });

    // 3. Search all 5 Qdrant collections in parallel (reduced limits for Slack)
    const [codeChunks, knowledgeChunks, reviewChunks, chatChunks, diagramChunks] = await Promise.all([
      repoIds.length > 0
        ? searchCodeChunksAcrossRepos(repoIds, queryVector, 10, question)
        : Promise.resolve([]),
      searchKnowledgeChunks(orgId, queryVector, 5, question),
      searchReviewChunks(orgId, queryVector, 3, question),
      searchChatChunks(orgId, queryVector, 3, undefined, question),
      searchDiagramChunks(orgId, queryVector, 2, question),
    ]);

    // 4. Build context strings (same format as chat route)
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
          `### [${(c.diagramType ?? "flowchart").toUpperCase()}] ${c.repoFullName} PR #${c.prNumber}: ${c.prTitle}\n\`\`\`mermaid\n${c.mermaidCode}\n\`\`\``,
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

    // Build rich context
    const repoList = allRepos
      .map((r) => {
        const contributors = Array.isArray(r.contributors) ? r.contributors as { login: string; contributions: number }[] : [];
        const topContributors = contributors.slice(0, 5).map((c) => `${c.login} (${c.contributions})`).join(", ");
        const lines = [
          `### ${r.fullName}`,
          `- Index: ${r.indexStatus}${r.indexedAt ? ` (${r.indexedAt.toISOString().split("T")[0]})` : ""} | Files: ${r.indexedFiles}/${r.totalFiles} | Chunks: ${r.totalChunks}`,
          `- PRs: ${r._count.pullRequests}${topContributors ? ` | Top: ${topContributors}` : ""}`,
        ];
        if (r.purpose) lines.push(`- Purpose: ${r.purpose}`);
        if (r.summary) lines.push(`- Summary: ${r.summary}`);
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
              `- ${pr.repository.fullName}#${pr.number}: ${pr.title} (by ${pr.author}, ${pr.status}) — ${pr.createdAt.toISOString().split("T")[0]}`,
          )
          .join("\n")
      : "No pull requests yet.";

    // 5. Slack-specific system prompt
    const systemPrompt = `You are Octopus, an AI assistant with deep knowledge of the user's codebase and organization.
A Slack user (@${userName}) is asking a question via the /octopus slash command.

RULES:
- Answer using Slack mrkdwn format (NOT markdown):
  - Use *bold* for emphasis (not **bold**)
  - Use _italic_ for file paths or subtle emphasis
  - Use \`code\` for inline code
  - Use \`\`\` for code blocks (no language tag needed)
  - Use bullet points with •
  - Do NOT use ## headers — use *bold text* on its own line instead
- Keep your answer concise — ideally under 2500 characters
- Cite file paths like \`path/to/file.ts:L42\`
- Be technical and direct
- If context is insufficient, say so honestly

<organization_info>
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

    // 6. Call Claude (non-streaming)
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: HARDCODED_REVIEW_MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: question }],
    });

    const aiAnswer = response.content[0].type === "text" ? response.content[0].text : "";

    // 9. Log AI usage
    await logAiUsage({
      provider: "anthropic",
      model: HARDCODED_REVIEW_MODEL,
      operation: "slack-command",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      organizationId: orgId,
    });

    // Truncate if too long for Slack (Block Kit text limit ~3000)
    const MAX_ANSWER_LENGTH = 2800;
    let answer = aiAnswer;
    if (answer.length > MAX_ANSWER_LENGTH) {
      answer = answer.slice(0, MAX_ANSWER_LENGTH) + "\n\n_...response truncated_";
    }

    // Build source counts for footer
    const sourceCounts = [
      codeChunks.length > 0 ? `${codeChunks.length} code` : null,
      knowledgeChunks.length > 0 ? `${knowledgeChunks.length} docs` : null,
      reviewChunks.length > 0 ? `${reviewChunks.length} reviews` : null,
      chatChunks.length > 0 ? `${chatChunks.length} chats` : null,
      diagramChunks.length > 0 ? `${diagramChunks.length} diagrams` : null,
    ].filter(Boolean).join(", ");

    // 7. POST response to Slack via response_url (Block Kit)
    const slackPayload = {
      response_type: "in_channel" as const,
      replace_original: true,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:octopus: *@${userName}* asked: _${question}_`,
          },
        },
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: answer,
          },
        },
        { type: "divider" },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Powered by Octopus${sourceCounts ? ` | Sources: ${sourceCounts}` : ""}`,
            },
          ],
        },
      ],
    };

    const slackResponse = await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slackPayload),
    });

    if (!slackResponse.ok) {
      console.error(`[slack-responder] Failed to POST to response_url: ${slackResponse.status} ${await slackResponse.text()}`);
    } else {
      console.log(`[slack-responder] Successfully responded to @${userName}'s question`);
    }

    // 8. Store Q&A pair in Qdrant for future context
    try {
      await ensureChatCollection();
      const qaPairText = `Q: ${question}\nA: ${aiAnswer}`.slice(0, 8000);
      const [qaVector] = await createEmbeddings([qaPairText], {
        organizationId: orgId,
        operation: "slack-command-embedding",
      });
      await upsertChatChunk({
        id: crypto.randomUUID(),
        vector: qaVector,
        sparseVector: generateSparseVector(qaPairText),
        payload: {
          orgId,
          userId: slackUserId,
          conversationId: `slack-${Date.now()}`,
          conversationTitle: `Slack: ${question.slice(0, 60)}`,
          question,
          answer: aiAnswer.slice(0, 4000),
          createdAt: new Date().toISOString(),
          source: "slack-command",
        },
      });
    } catch (err) {
      console.error("[slack-responder] Failed to store Q&A in Qdrant:", err);
    }
  } catch (err) {
    console.error("[slack-responder] Error processing question:", err);

    // Send error message to Slack
    try {
      await fetch(responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response_type: "ephemeral",
          replace_original: true,
          text: `:warning: Sorry, I couldn't process your question. Please try again later.\n\nIf the issue persists, check that repositories are indexed in Octopus.`,
        }),
      });
    } catch (postErr) {
      console.error("[slack-responder] Failed to send error to Slack:", postErr);
    }
  }
}
