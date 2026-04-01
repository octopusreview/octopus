import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { headers } from "next/headers";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { topic } = await request.json();

  if (!topic || typeof topic !== "string") {
    return NextResponse.json({ error: "Topic is required" }, { status: 400 });
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: `You generate email content for Octopus, an AI-powered code review tool.

## Product Info
- Product: Octopus, AI-powered code review for GitHub and Bitbucket PRs
- Features: auto PR review, knowledge docs, codebase indexing, team feedback learning

## App URLs (ALWAYS use {{appUrl}} variable, NEVER hardcode any domain)
- {{appUrl}}/dashboard
- {{appUrl}}/repositories
- {{appUrl}}/settings
- {{appUrl}}/settings/billing
- {{appUrl}}/settings/notifications
- {{appUrl}}/knowledge
- {{appUrl}}/login

## Available Variables
Use these inside double curly braces. Only use variables that make sense for the email topic.
- {{firstName}} - recipient's first name
- {{appUrl}} - application base URL
- {{organizationName}} - user's organization name
- {{repoFullName}} - repository full name (e.g. "acme/my-repo")
- {{prNumber}} - pull request number
- {{prTitle}} - pull request title
- {{prUrl}} - pull request URL
- {{prAuthor}} - PR author name
- {{findingsCount}} - number of review findings
- {{filesChanged}} - number of files changed
- {{balance}} - credit balance (e.g. "$4.20")
- {{documentTitle}} - knowledge document title
- {{error}} - error message
- {{inviterName}} - person who sent invitation
- {{role}} - assigned role

## Writing Rules
- Friendly, concise, founder-to-user tone
- No em dashes (use commas, "and", or periods instead)
- Keep it short and actionable
- Output valid JSON only, no markdown fences

## JSON Format
{
  "name": "Template display name",
  "subject": "Email subject line",
  "body": "Email body. Paragraphs separated by blank lines. Use **bold** for emphasis, [text](url) for links, - for bullet points.",
  "buttonText": "CTA button text or null",
  "buttonUrl": "CTA URL using {{appUrl}} variable, or null"
}`,
    messages: [
      {
        role: "user",
        content: `Generate an email template about: ${topic}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  try {
    // Strip markdown fences if present
    const cleaned = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json(
      { error: "Failed to parse AI response", raw: text },
      { status: 500 },
    );
  }
}
