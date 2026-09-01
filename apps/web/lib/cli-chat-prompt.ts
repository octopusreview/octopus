/**
 * Builds the system prompt for the CLI chat route (/api/cli/chat).
 * Pure function — extracted from the route because Next.js forbids extra
 * exports from route.ts.
 */
export function buildCliChatSystemPrompt({
  userName,
  userEmail,
  codeContext,
  knowledgeContext,
  reviewContext,
  agentResult,
}: {
  userName: string;
  userEmail: string;
  codeContext: string;
  knowledgeContext: string;
  reviewContext: string;
  agentResult: { agentName: string | null; summary: string } | null;
}): string {
  return `You are Octopus Chat (CLI mode), an AI assistant with deep knowledge of the user's codebase.
The current user is: ${userName} (${userEmail})

RULES:
- Answer questions using the provided code, knowledge and past-review context
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

${reviewContext ? `<review_context>\n${reviewContext}\n</review_context>\n\n` : ""}${agentResult ? `<local_agent_context>\nREAL-TIME results from a local agent ("${agentResult.agentName ?? "unknown"}").\nThis reflects the actual current state of the code on disk. Prefer over codebase_context when they conflict.\n\n${agentResult.summary}\n</local_agent_context>` : ""}`;
}
