"use server";

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import Anthropic from "@anthropic-ai/sdk";
import { logAiUsage } from "@/lib/ai-usage";
import { isOrgOverSpendLimit } from "@/lib/cost";
import { getReviewModel } from "@/lib/ai-client";

// ── Helpers ──

async function getSessionAndOrg(): Promise<{ orgId: string } | { error: string }> {
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
  if (!member) return { error: "Not a member of this organization." };

  return { orgId };
}

let anthropicClient: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return anthropicClient;
}

// ── Generate issue content ──

export async function generateIssueContent(
  issueId: string,
): Promise<{ title: string; description: string } | { error: string }> {
  const ctx = await getSessionAndOrg();
  if ("error" in ctx) return { error: ctx.error };
  const { orgId } = ctx;

  // Check spend limit
  if (await isOrgOverSpendLimit(orgId)) {
    return { error: "Monthly AI usage limit reached. Please upgrade or wait until next month." };
  }

  const issue = await prisma.reviewIssue.findUnique({
    where: { id: issueId },
    include: {
      pullRequest: {
        select: { url: true, title: true, number: true, repository: { select: { organizationId: true } } },
      },
    },
  });

  if (!issue) return { error: "Issue not found." };

  if (issue.pullRequest.repository.organizationId !== orgId) {
    return { error: "Issue does not belong to this organization." };
  }

  const model = await getReviewModel(orgId);

  try {
    const response = await getAnthropicClient().messages.create({
      model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are a senior software engineer creating a structured bug report from an automated code review finding.

Review finding data:
- Title: ${issue.title}
- Description: ${issue.description}
- Severity: ${issue.severity}
- File: ${issue.filePath ?? "N/A"}${issue.lineNumber ? `:${issue.lineNumber}` : ""}
- Pull Request: ${issue.pullRequest.title} (#${issue.pullRequest.number})
- PR URL: ${issue.pullRequest.url}

Generate a well-structured bug report in JSON format with two fields:
1. "title": A concise, actionable issue title (max 80 chars). Do not just copy the review title — improve it.
2. "description": A structured plain-text description with the following sections separated by blank lines:

## Summary
One-paragraph summary of the issue.

## Details
Technical details about what was found and why it matters.

## Location
File path, line number, and PR reference.

## Suggested Action
Clear steps to fix the issue.

Write everything in English. Be professional and concise. Do NOT use markdown code fences in the description, use plain text with ## headers.

Respond ONLY with valid JSON: {"title": "...", "description": "..."}`,
        },
      ],
    });

    logAiUsage({
      provider: model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3") ? "openai" : "anthropic",
      model,
      operation: "generate-issue-content",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      organizationId: orgId,
    }).catch(console.warn);

    let text = response.content[0].type === "text" ? response.content[0].text : "";

    // Strip markdown code fences if present
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      text = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(text);
    return {
      title: parsed.title ?? issue.title,
      description: parsed.description ?? issue.description,
    };
  } catch (err) {
    console.error("[issue-content] AI content generation failed:", err);
    // Fallback to raw issue data
    return {
      title: issue.title,
      description: `## Summary\n${issue.description}\n\n## Location\n${issue.filePath ?? "N/A"}${issue.lineNumber ? `:${issue.lineNumber}` : ""}\n\n## Source\nPR: ${issue.pullRequest.title} (#${issue.pullRequest.number})\n${issue.pullRequest.url}`,
    };
  }
}
