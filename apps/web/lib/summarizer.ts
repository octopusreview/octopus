import { getRepoChunks } from "@/lib/qdrant";
import { logAiUsage } from "@/lib/ai-usage";
import { getReviewModel } from "@/lib/ai-client";
import { createAiMessage } from "@/lib/ai-router";
import { isOrgOverSpendLimit } from "@/lib/cost";
import { extractJsonObject } from "@/lib/extract-json";

export async function summarizeRepository(
  repoId: string,
  fullName: string,
  organizationId?: string,
): Promise<{ summary: string; purpose: string }> {
  if (organizationId && await isOrgOverSpendLimit(organizationId)) {
    console.warn(`[summarizer] Org ${organizationId} over spend limit — skipping summarize`);
    return { summary: "Skipped: monthly AI usage limit reached.", purpose: "Unknown" };
  }

  const chunks = await getRepoChunks(repoId, 40);

  if (chunks.length === 0) {
    return {
      summary: "No indexable content found in this repository.",
      purpose: "Unknown",
    };
  }

  const codeContext = chunks.join("\n\n---\n\n");

  const model = organizationId ? await getReviewModel(organizationId, repoId) : "claude-sonnet-4-20250514";

  const response = await createAiMessage(
    {
      model,
      maxTokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are analyzing the repository "${fullName}". Below are code snippets from the repository.

Provide:
1. **Purpose**: A single sentence (max 15 words) describing what this project does. Be specific, not generic.
2. **Summary**: A concise 2-4 sentence technical summary covering: what the project is, main technologies/frameworks used, and key functionality.

Respond in this exact JSON format, nothing else:
{"purpose": "...", "summary": "..."}

Code snippets:
${codeContext}`,
        },
      ],
    },
    organizationId || "",
  );

  if (organizationId) {
    await logAiUsage({
      provider: response.provider,
      model,
      operation: "summarize-repo",
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      cacheReadTokens: response.usage.cacheReadTokens,
      cacheWriteTokens: response.usage.cacheWriteTokens,
      organizationId,
    });
  }

  const text = response.text;
  // extractJsonObject handles strict-parse, code-fenced, AND balanced-scan
  // recovery in one call. The old inline implementation only handled the
  // first two; an LLM that wrapped its JSON in any prose ("Here's the
  // summary:") would silently fall through to the text.slice(0, 500)
  // fallback even though the JSON itself was perfectly valid.
  const parsed = extractJsonObject(text);
  if (parsed) {
    return {
      purpose: (parsed.purpose as string | undefined) ?? "Unknown",
      summary: (parsed.summary as string | undefined) ?? "No summary available.",
    };
  }
  return {
    purpose: "Unknown",
    summary: text.slice(0, 500),
  };
}

export async function summarizeDailyReviews(
  reviews: {
    repo: string;
    prNumber: number;
    title: string;
    author: string;
    reviewBody: string;
  }[],
  organizationId?: string,
): Promise<string> {
  if (organizationId && await isOrgOverSpendLimit(organizationId)) {
    console.warn(`[summarizer] Org ${organizationId} over spend limit — skipping daily summary`);
    return "";
  }

  // Build context from review bodies (truncate each to keep within limits)
  const reviewContext = reviews
    .map((r) => {
      const body = r.reviewBody.slice(0, 4000);
      return `### ${r.repo}#${r.prNumber}: ${r.title} (by ${r.author})\n${body}`;
    })
    .join("\n\n---\n\n");

  const dailyModel = organizationId ? await getReviewModel(organizationId) : "claude-sonnet-4-20250514";

  const response = await createAiMessage(
    {
      model: dailyModel,
      maxTokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are an engineering team assistant. Below are AI code review results from today's pull requests.

Write a concise daily summary (3-6 sentences) covering:
- What areas of the codebase were changed
- Key findings and patterns across reviews (security issues, code quality, bugs)
- Notable improvements or concerns
- Who contributed

Keep the tone professional and brief. Do NOT use markdown headers or bullet points — write flowing prose. Do NOT repeat PR titles verbatim.

Reviews:
${reviewContext}`,
        },
      ],
    },
    organizationId || "",
  );

  if (organizationId) {
    await logAiUsage({
      provider: response.provider,
      model: dailyModel,
      operation: "summarize-daily",
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      cacheReadTokens: response.usage.cacheReadTokens,
      cacheWriteTokens: response.usage.cacheWriteTokens,
      organizationId,
    });
  }

  return response.text.trim();
}
