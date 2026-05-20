import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { authenticateApiToken } from "@/lib/api-auth";
import { generateBareLocalReview, ReviewConfigError } from "@/lib/review-core";
import { isOrgOverSpendLimit } from "@/lib/cost";
import { writeAuditLog } from "@/lib/audit";
import { MAX_LOCAL_REVIEW_DIFF_BYTES } from "@/lib/cli-limits";

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
const MAX_DIFF_BYTES = MAX_LOCAL_REVIEW_DIFF_BYTES;

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

    // Audit each CLI review so admins have visibility into who's running
    // what against the server (powering /settings/cli-usage). Best-effort —
    // never block the response on the audit write.
    const reqHeaders = await headers();
    await writeAuditLog({
      action: "cli.review_local",
      category: "review",
      actorId: auth.user?.id ?? null,
      actorEmail: auth.user?.email ?? null,
      organizationId: auth.org.id,
      targetType: "local-diff",
      metadata: {
        mode: "bare",
        diffBytes: body.diff.length,
        findingCount: result.findings.length,
        model: result.model,
        title: body.title ?? null,
      },
      ipAddress: reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: reqHeaders.get("user-agent") ?? null,
    }).catch((e) => console.error("[review-local] audit log failed:", e));

    return NextResponse.json({
      findings: result.findings,
      summary: result.summary,
      model: result.model,
      usage: result.usage,
      bareMode: true,
    });
  } catch (err) {
    console.error("[review-local] Review generation failed:", err);
    // Recoverable config error — the message is safe to surface in
    // production because it tells the user how to fix the problem
    // (set an API key / pick a different model) without leaking
    // internal context. Return 422 so the CLI can distinguish from
    // generic 500s.
    if (err instanceof ReviewConfigError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    // Everything else: generic in prod, real error in dev.
    const isProd = process.env.NODE_ENV === "production";
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: isProd ? "Review generation failed" : `Review generation failed: ${detail}` },
      { status: 500 },
    );
  }
}
