import { NextResponse } from "next/server";
import { authenticateApiToken } from "@/lib/api-auth";
import { generateBareLocalReview } from "@/lib/review-core";
import { isOrgOverSpendLimit } from "@/lib/cost";

/**
 * POST /api/cli/review-local
 *
 * Bare-mode local review for `octp review` when the repo isn't (yet)
 * connected to Octopus. Same LLM call + findings parser as the
 * canonical `/api/cli/repos/[id]/local-review`, but without:
 *
 *   - vector context search (needs an indexed repo)
 *   - repo-level review config (uses org defaults)
 *   - two-pass validation / conflict detection (need repo history)
 *
 * Quality is materially worse than the with-context path — that's the
 * trade-off. The CLI surfaces this to the user with a one-line note.
 *
 * Still gates on isOrgOverSpendLimit so a token can't run unlimited
 * paid reviews after the org has exceeded its cap. ai_usage rows get
 * the same `local-review` operation tag as the context-aware path so
 * billing/reporting groups them together.
 */
const MAX_DIFF_BYTES = 500 * 1024;

type Body = {
  diff?: string;
  title?: string;
  author?: string;
  /**
   * Optional model id the CLI passes from the wizard's saved config so the
   * server honours per-machine choices (eg. "ollama:qwen2.5-coder:32b"). Falls
   * back to the org default when absent.
   */
  model?: string;
};

export async function POST(request: Request) {
  const auth = await authenticateApiToken(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (await isOrgOverSpendLimit(auth.org.id)) {
    return NextResponse.json({ error: "Monthly spend limit reached" }, { status: 402 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  if (typeof body.diff !== "string" || body.diff.length === 0) {
    return NextResponse.json({ error: "diff is required" }, { status: 400 });
  }
  if (body.diff.length > MAX_DIFF_BYTES) {
    return NextResponse.json(
      { error: `Diff too large (max ${MAX_DIFF_BYTES} bytes)` },
      { status: 413 },
    );
  }

  try {
    const result = await generateBareLocalReview({
      diff: body.diff,
      orgId: auth.org.id,
      title: body.title,
      author: body.author,
      modelOverride: typeof body.model === "string" ? body.model : undefined,
    });
    return NextResponse.json({
      findings: result.findings,
      summary: result.summary,
      model: result.model,
      usage: result.usage,
      bareMode: true,
    });
  } catch (err) {
    // Log the real error server-side. In production, return a generic
    // message so internal context (model names, org ids, provider error
    // bodies) doesn't leak. In dev, include err.message so self-hosters
    // can diagnose their first install without grepping server logs.
    console.error("[review-local] Review generation failed:", err);
    const isProd = process.env.NODE_ENV === "production";
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        // Generic message in production so internal details (model names,
        // org ids, provider error bodies) never leak via the API. In dev,
        // append the real error so self-hosters can diagnose without
        // grepping server logs.
        error: isProd ? "Review generation failed" : `Review generation failed: ${detail}`,
      },
      { status: 500 },
    );
  }
}
