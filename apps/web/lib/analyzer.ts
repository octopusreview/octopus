import { getRepoChunks, getKnowledgeChunksByOrg } from "@/lib/qdrant";
import { logAiUsage } from "@/lib/ai-usage";
import { getReviewModel } from "@/lib/ai-client";
import { createAiMessage } from "@/lib/ai-router";
import { isOrgOverSpendLimit } from "@/lib/cost";
import fs from "node:fs";
import path from "node:path";

let coreIdentity: string | null = null;

function getCoreIdentity(): string {
  if (!coreIdentity) {
    coreIdentity = fs.readFileSync(
      path.join(process.cwd(), "prompts", "CORE_IDENTITY.md"),
      "utf-8",
    );
  }
  return coreIdentity;
}

type LogLevel = "info" | "success" | "error" | "warning";

export async function analyzeRepository(
  repoId: string,
  fullName: string,
  orgId?: string,
  emitLog?: (message: string, level?: LogLevel) => void,
  signal?: AbortSignal,
): Promise<string> {
  const log = emitLog ?? (() => {});

  if (signal?.aborted) throw new Error("Analysis cancelled");

  if (orgId && await isOrgOverSpendLimit(orgId)) {
    log("Monthly AI usage limit reached — skipping analysis", "warning");
    console.warn(`[analyzer] Org ${orgId} over spend limit — skipping analysis`);
    return "Skipped: monthly AI usage limit reached.";
  }

  log("Fetching code chunks from vector database...");
  if (signal?.aborted) throw new Error("Analysis cancelled");

  // Databricks Vector Search Direct Access indexes are eventually consistent —
  // upserts can take several seconds before scan sees the new rows. Retry with
  // backoff so analyses kicked off right after indexing don't false-fail.
  let chunks: string[] = [];
  const backoffMs = [0, 2_000, 5_000, 10_000, 20_000];
  for (let attempt = 0; attempt < backoffMs.length; attempt++) {
    if (signal?.aborted) throw new Error("Analysis cancelled");
    if (backoffMs[attempt] > 0) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt]));
    }
    chunks = await getRepoChunks(repoId, 80);
    if (chunks.length > 0) break;
    if (attempt < backoffMs.length - 1) {
      log(`No chunks visible yet — retrying (attempt ${attempt + 2}/${backoffMs.length})...`, "warning");
    }
  }

  if (chunks.length === 0) {
    log("No indexable content found", "warning");
    return "No indexable content found in this repository.";
  }

  log(`Loaded ${chunks.length} code chunks`, "success");

  let codeContext = chunks.join("\n\n---\n\n");

  // Append organization knowledge if available
  if (orgId) {
    if (signal?.aborted) throw new Error("Analysis cancelled");
    log("Fetching organization knowledge...");
    const knowledgeChunks = await getKnowledgeChunksByOrg(orgId, 20);
    if (knowledgeChunks.length > 0) {
      codeContext += "\n\n--- Organization Guidelines ---\n\n" + knowledgeChunks.join("\n\n---\n\n");
      log(`Loaded ${knowledgeChunks.length} knowledge chunks`, "success");
    }
  }

  if (signal?.aborted) throw new Error("Analysis cancelled");
  const analyzeModel = orgId ? await getReviewModel(orgId, repoId) : "claude-sonnet-4-20250514";
  log(`Running AI analysis with ${analyzeModel}...`);

  const response = await createAiMessage(
    {
      model: analyzeModel,
      maxTokens: 4096,
      system: getCoreIdentity(),
      cacheSystem: true,
      messages: [
        {
          role: "user",
          content: `Analyze the repository "${fullName}" using the code snippets below. If organization guidelines are provided at the end, also check the codebase against those guidelines and note any deviations. Provide a thorough analysis with exactly these 6 sections (use ## headers):

## Architecture Overview
Describe the overall architecture, design patterns, and codebase structure. Trace key execution paths across files where relevant (e.g. \`Request → middleware/auth.ts → services/user.ts → repositories/user.ts\`). Note any non-obvious behaviors or implicit contracts.

## Tech Stack
List the main technologies, frameworks, libraries, and tools. Note version-specific patterns or constraints when visible in the code.

## Code Quality
Assess consistency, naming conventions, error handling (especially for async operations and API calls), test coverage indicators, and best practices adherence. Flag any deviations from established coding conventions within the repository. Identify dead code, unreachable branches, and redundant conditions.

## Security Observations
Systematically check for: injection attacks (SQL, XSS, command injection, path traversal), authentication & authorization gaps (missing auth checks, IDOR, privilege escalation, JWT issues), data exposure (hardcoded secrets, sensitive data in logs, overly permissive CORS), and infrastructure concerns (missing rate limiting, SSRF, insecure defaults). Use severity indicators: 🔴 Critical, 🟠 High, 🟡 Medium, 🔵 Low. If no significant issues found, note the positive security patterns in use.

## Key Components
Identify the most important modules, classes, or functions. For each, describe: entry point(s), key files involved, data flow, and important side effects. When multiple approaches exist in the codebase, mention all of them.

## Dependencies & Risks
Analyze external dependencies, potential risks, outdated patterns, and areas needing attention. Check for: race conditions, memory leaks (event listeners, unclosed connections), unhandled promise rejections, resource exhaustion risks (unbounded loops, missing pagination), and potential N+1 queries or inefficient data fetching.

Code snippets:
${codeContext}`,
        },
      ],
    },
    orgId || "",
  );

  if (signal?.aborted) throw new Error("Analysis cancelled");
  log("AI analysis complete", "success");

  if (orgId) {
    log("Logging AI usage...");
    await logAiUsage({
      provider: response.provider,
      model: analyzeModel,
      operation: "analyze",
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      cacheReadTokens: response.usage.cacheReadTokens,
      cacheWriteTokens: response.usage.cacheWriteTokens,
      organizationId: orgId,
    });
  }

  return response.text;
}
