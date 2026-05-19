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
    });
    return NextResponse.json({
      findings: result.findings,
      summary: result.summary,
      model: result.model,
      usage: result.usage,
      bareMode: true,
    });
  } catch (err) {
    console.error("[review-local] Review generation failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Review generation failed" },
      { status: 500 },
    );
  }
}
