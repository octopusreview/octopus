import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@octopus/db";
import { createEmbeddings } from "@/lib/embeddings";
import { searchDocsChunks, ensureDocsCollection } from "@/lib/qdrant";

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return anthropicClient;
}

// Simple in-memory rate limiter (per IP, 10 requests/minute)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > RATE_LIMIT;
}

const SYSTEM_PROMPT = `You are Octopus Assistant, a helpful AI that answers questions about Octopus — an open-source, AI-powered code review tool.

<octopus_overview>
Octopus is an open-source, AI-powered code review tool. It connects to GitHub and Bitbucket, indexes your codebase using vector embeddings (OpenAI text-embedding-3-large, stored in Qdrant), and automatically reviews every pull request. Findings are posted as inline PR comments with severity levels: 🔴 Critical, 🟠 Major, 🟡 Minor, 🔵 Suggestion, 💡 Tip.

Key features: RAG Chat (ask questions about your codebase), CLI tool (npm install -g @octp/cli), Codebase Indexing, Knowledge Base (custom review rules), Team Sharing, Analytics, Slack & Linear integrations. Self-hostable with Docker (MIT license). Supports Bring Your Own Keys (BYOK) for Anthropic, OpenAI, Google, Cohere. Credit-based pricing with free tier.

Tech stack: Next.js (App Router, React 19), Prisma + PostgreSQL, Qdrant vector DB, Claude & OpenAI, Tailwind CSS, TypeScript, Turborepo monorepo.
</octopus_overview>

Use the documentation context provided with each question to give detailed, accurate answers. If context is provided, prefer it over the overview above. If no context is available, answer from the overview.

Guidelines:
- Be concise and helpful. Keep answers short and direct.
- Use markdown formatting for readability.
- When relevant, mention specific features, commands, or configuration options.
- If asked about something unrelated to Octopus, politely redirect: "I can only help with questions about Octopus. Is there something about the code review tool I can help with?"
- Never make up features or capabilities not mentioned in the context or overview.
- Respond in the same language the user writes in.`;

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const userAgent = request.headers.get("user-agent") || undefined;

  if (isRateLimited(ip)) {
    return Response.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429 },
    );
  }

  const body = await request.json();
  const { message, history, fingerprint, sessionId } = body as {
    message?: string;
    history?: { role: "user" | "assistant"; content: string }[];
    fingerprint?: string;
    sessionId?: string;
  };

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return Response.json({ error: "Message is required" }, { status: 400 });
  }

  if (message.length > 1000) {
    return Response.json({ error: "Message too long (max 1000 chars)" }, { status: 400 });
  }

  const fp = (typeof fingerprint === "string" && fingerprint.length > 0) ? fingerprint : "unknown";

  try {
    // Get or create session
    let session;
    if (sessionId) {
      session = await prisma.askOctopusSession.findUnique({
        where: { id: sessionId },
      });
    }
    if (!session) {
      session = await prisma.askOctopusSession.create({
        data: {
          fingerprint: fp,
          ipAddress: ip,
          userAgent,
        },
      });
    }

    // Save user message
    await prisma.askOctopusMessage.create({
      data: {
        sessionId: session.id,
        role: "user",
        content: message.trim(),
      },
    });

    await ensureDocsCollection();

    // Create embedding for the query
    const [queryVector] = await createEmbeddings([message]);

    if (!queryVector || queryVector.length === 0) {
      return Response.json({ error: "Failed to process query" }, { status: 500 });
    }

    // Search docs chunks
    const results = await searchDocsChunks(queryVector, 8, message);

    // Build context from results
    const context = results.length > 0
      ? results.map((r) => `### ${r.title}\n${r.text}`).join("\n\n---\n\n")
      : "No additional documentation context available. Answer from the overview in your system prompt.";

    // Build message history (last 6 messages max)
    const messages: { role: "user" | "assistant"; content: string }[] = [];

    if (history && Array.isArray(history)) {
      const recentHistory = history.slice(-6);
      for (const msg of recentHistory) {
        if (msg.role === "user" || msg.role === "assistant") {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    }

    // Add current message with context
    messages.push({
      role: "user",
      content: `<documentation_context>\n${context}\n</documentation_context>\n\nUser question: ${message}`,
    });

    const client = getAnthropicClient();

    // Stream the response
    const aiStream = await client.messages.stream({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages,
    });

    // Return as SSE stream
    const encoder = new TextEncoder();
    let fullResponse = "";
    const currentSessionId = session.id;

    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Send session ID first
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ session_id: currentSessionId })}\n\n`),
          );

          for await (const event of aiStream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              fullResponse += event.delta.text;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ delta: event.delta.text })}\n\n`),
              );
            }
          }

          // Save assistant response to DB (fire and forget)
          prisma.askOctopusMessage.create({
            data: {
              sessionId: currentSessionId,
              role: "assistant",
              content: fullResponse,
            },
          }).catch((err) => {
            console.error("[ask-octopus] Failed to save assistant message:", err);
          });

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err) {
          console.error("[ask-octopus] Stream error:", err);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: "Stream interrupted" })}\n\n`),
          );
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[ask-octopus] Error:", error);
    return Response.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
