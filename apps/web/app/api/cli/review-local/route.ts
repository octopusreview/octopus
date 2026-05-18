import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { authenticateApiToken } from "@/lib/api-auth";
import { createAiMessage } from "@/lib/ai-router";
import { parseFindingsFromJson, type InlineFinding } from "@/lib/review-dedup";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@octopus/db";

/**
 * POST /api/cli/review-local
 *
 * Pre-PR review endpoint used by `octp review`. The CLI computes a diff
 * locally (working tree / staged / since-ref) and POSTs it here; the
 * server runs it through the same review pipeline that processReview
 * uses for PR reviews — same system prompt, same provider routing, same
 * findings parser. The response is the parsed findings as JSON.
 *
 * What this is NOT:
 *   - Not a PR review (no comments posted anywhere, no GitHub call)
 *   - Not a replacement for processReview — the cloud review still runs
 *     on every PR for the everyone-coverage guarantee. This is additive:
 *     individual devs get fast feedback before they push.
 *
 * Billing: usage logged via the standard `logAiUsage` path inside
 * createAiMessage. BYOK keys count as the user's own; platform keys
 * deduct credits like any other review.
 *
 * Auth: requires an OrgApiToken (the `oct_…` token the wizard writes
 * to ~/.octopus/credentials).
 *
 * Diff size cap: hard limit of 200KB inbound. Larger diffs are
 * truncated by the CLI before they hit this endpoint and a warning
 * surfaces in the response.
 */
const MAX_DIFF_BYTES = 200 * 1024;

type Body = {
  diff?: string;
  /** Optional context the CLI may include (eg. branch name) for the prompt. */
  context?: { branch?: string; baseRef?: string };
};

type ResponseShape = {
  findings: InlineFinding[];
  model: string;
  provider: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  truncated?: boolean;
};

let systemPromptTemplate: string | null = null;
function getSystemPrompt(): string {
  if (!systemPromptTemplate) {
    const promptsDir = path.join(process.cwd(), "prompts");
    let template = fs.readFileSync(path.join(promptsDir, "SYSTEM_PROMPT.md"), "utf-8");
    try {
      const diagramRules = fs.readFileSync(path.join(promptsDir, "DIAGRAM_RULES.md"), "utf-8");
      template = template.replace("{{DIAGRAM_RULES}}", diagramRules);
    } catch {
      // DIAGRAM_RULES is optional for the local-review path — strip the
      // placeholder if the file isn't present.
      template = template.replace("{{DIAGRAM_RULES}}", "");
    }
    systemPromptTemplate = template;
  }
  return systemPromptTemplate;
}

export async function POST(request: Request): Promise<NextResponse<ResponseShape | { error: string }>> {
  const auth = await authenticateApiToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const diff = body.diff;
  if (typeof diff !== "string" || diff.length === 0) {
    return NextResponse.json({ error: "diff is required" }, { status: 400 });
  }
  if (diff.length > MAX_DIFF_BYTES) {
    return NextResponse.json(
      { error: `diff too large (${diff.length} bytes, max ${MAX_DIFF_BYTES})` },
      { status: 413 },
    );
  }

  // Resolve the org's configured review model. Same lookup the cloud
  // review uses — if the user/org hasn't set a default, fall back to
  // the platform default in AvailableModel.isPlatformDefault.
  const orgDefault = await prisma.organization.findUnique({
    where: { id: auth.org.id },
    select: { defaultModelId: true },
  });
  let modelId = orgDefault?.defaultModelId ?? null;
  if (!modelId) {
    const platformDefault = await prisma.availableModel.findFirst({
      where: { category: "llm", isPlatformDefault: true },
      select: { modelId: true },
    });
    modelId = platformDefault?.modelId ?? "claude-sonnet-4-6-20250619";
  }

  const userPrompt = [
    body.context?.branch ? `Branch: ${body.context.branch}` : null,
    body.context?.baseRef ? `Base: ${body.context.baseRef}` : null,
    "",
    "Review the following diff. Return findings using the standard format —",
    "between OCTOPUS_FINDINGS_START / OCTOPUS_FINDINGS_END markers as a JSON",
    "array. This is a pre-PR review running locally for the developer; be",
    "actionable and concise, no narrative summary needed.",
    "",
    "```diff",
    diff,
    "```",
  ]
    .filter((l) => l !== null)
    .join("\n");

  const response = await createAiMessage(
    {
      model: modelId,
      maxTokens: 8000,
      system: getSystemPrompt(),
      messages: [{ role: "user", content: userPrompt }],
    },
    auth.org.id,
  );

  const findings = parseFindingsFromJson(response.text) ?? [];

  await writeAuditLog({
    action: "review.local_run",
    category: "review",
    actorId: auth.user?.id ?? null,
    actorEmail: auth.user?.email ?? null,
    organizationId: auth.org.id,
    targetType: "local-diff",
    metadata: {
      diffBytes: diff.length,
      findingCount: findings.length,
      model: modelId,
      branch: body.context?.branch ?? null,
    },
  }).catch((err) => {
    console.error("[review-local] audit log failed:", err);
  });

  return NextResponse.json({
    findings,
    model: response.model,
    provider: response.provider,
    usage: {
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
    },
  });
}
