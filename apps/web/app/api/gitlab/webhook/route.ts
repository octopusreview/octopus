import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { getPullRequestDetails } from "@/lib/gitlab";
import { startReviewFlow } from "@/lib/webhook-shared";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const event = request.headers.get("x-gitlab-event");
  const tokenHeader = request.headers.get("x-gitlab-token");

  if (!event) {
    return NextResponse.json({ error: "Missing event header" }, { status: 400 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const project = payload.project as Record<string, unknown> | undefined;
  const projectId = project?.id;
  if (typeof projectId !== "number") {
    return NextResponse.json({ error: "Missing project id" }, { status: 400 });
  }

  // Look up repository by external id, then the integration via its org
  const repo = await prisma.repository.findFirst({
    where: { provider: "gitlab", externalId: String(projectId) },
    select: { id: true, organizationId: true, autoReview: true, fullName: true },
  });

  if (!repo) {
    console.warn(`[gitlab-webhook] No repo found for project ${projectId}`);
    return NextResponse.json({ ok: true });
  }

  const integration = await prisma.gitlabIntegration.findUnique({
    where: { organizationId: repo.organizationId },
    select: { webhookSecret: true },
  });

  if (!integration?.webhookSecret) {
    console.error(`[gitlab-webhook] No webhook secret for org ${repo.organizationId}`);
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  // GitLab uses a shared-secret token, not an HMAC signature.
  const expected = Buffer.from(integration.webhookSecret, "utf8");
  const actual = Buffer.from(tokenHeader ?? "", "utf8");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const orgId = repo.organizationId;
  const repoFullName = repo.fullName;

  // ── Merge Request open/update → auto-review ──
  if (event === "Merge Request Hook") {
    const objectAttrs = payload.object_attributes as Record<string, unknown> | undefined;
    const action = objectAttrs?.action as string | undefined;
    const state = objectAttrs?.state as string | undefined;

    // Trigger on open, reopen, or push updates
    if (!objectAttrs || (action !== "open" && action !== "reopen" && action !== "update")) {
      return NextResponse.json({ ok: true });
    }

    // For "update" events, only re-review when the source branch was pushed (new commits).
    // GitLab signals this via oldrev being present in object_attributes.
    if (action === "update" && !objectAttrs.oldrev) {
      return NextResponse.json({ ok: true });
    }

    if (state === "merged" || state === "closed") {
      return NextResponse.json({ ok: true });
    }

    const mrIid = objectAttrs.iid as number | undefined;
    if (!mrIid || typeof mrIid !== "number") {
      return NextResponse.json({ error: "Missing MR iid" }, { status: 400 });
    }

    const user = payload.user as Record<string, string> | undefined;
    const prTitle = (objectAttrs.title as string) ?? `MR !${mrIid}`;
    const prUrl = (objectAttrs.url as string) ?? "";
    const prAuthor = user?.name ?? user?.username ?? "unknown";
    const headSha = (objectAttrs.last_commit as Record<string, string> | undefined)?.id ?? "";

    if (!repo.autoReview) {
      console.log(`[gitlab-webhook] Auto-review disabled for ${repoFullName}, skipping`);
      return NextResponse.json({ ok: true });
    }

    await startReviewFlow({
      provider: "gitlab",
      organizationId: orgId,
      repoFullName,
      repoId: repo.id,
      orgId,
      prNumber: mrIid,
      prTitle,
      prUrl,
      prAuthor,
      headSha,
      triggerCommentId: 0,
      triggerCommentBody: "",
    });

    console.log(`[gitlab-webhook] Auto-review triggered for ${repoFullName}!${mrIid}`);
  }

  // ── MR merged → mark as merged ──
  if (event === "Merge Request Hook") {
    const objectAttrs = payload.object_attributes as Record<string, unknown> | undefined;
    const state = objectAttrs?.state as string | undefined;
    const mrIid = objectAttrs?.iid as number | undefined;

    if (state === "merged" && mrIid && typeof mrIid === "number") {
      await Promise.all([
        prisma.pullRequest.updateMany({
          where: { repositoryId: repo.id, number: mrIid },
          data: { mergedAt: new Date() },
        }),
        prisma.repository.update({
          where: { id: repo.id },
          data: { indexStatus: "stale" },
        }),
      ]);
      console.log(`[gitlab-webhook] MR !${mrIid} merged, repo index marked as stale`);
    }
  }

  // ── @octopus mention in MR comment ──
  if (event === "Note Hook") {
    const objectAttrs = payload.object_attributes as Record<string, unknown> | undefined;
    const noteableType = objectAttrs?.noteable_type as string | undefined;
    if (noteableType !== "MergeRequest") {
      return NextResponse.json({ ok: true });
    }

    const commentBody = (objectAttrs?.note as string) ?? "";
    const mentionsOctopus = /@octopus(?:review|-review)?\b/i.test(commentBody);
    if (!mentionsOctopus) {
      return NextResponse.json({ ok: true });
    }

    const mr = payload.merge_request as Record<string, unknown> | undefined;
    const mrIid = mr?.iid as number | undefined;
    const commentId = (objectAttrs?.id as number) ?? 0;

    if (!mrIid || typeof mrIid !== "number") {
      return NextResponse.json({ error: "Missing MR iid" }, { status: 400 });
    }

    let prTitle = (mr?.title as string) ?? `MR !${mrIid}`;
    let prUrl = (mr?.url as string) ?? "";
    const user = payload.user as Record<string, string> | undefined;
    let prAuthor = user?.name ?? user?.username ?? "unknown";
    let headSha = (mr?.last_commit as Record<string, string> | undefined)?.id ?? "";

    try {
      const details = await getPullRequestDetails(orgId, repoFullName, mrIid);
      prTitle = details.title;
      prUrl = details.url;
      prAuthor = details.author;
      headSha = details.headSha;
    } catch (err) {
      console.warn("[gitlab-webhook] Failed to fetch MR details:", err);
    }

    await startReviewFlow({
      provider: "gitlab",
      organizationId: orgId,
      repoFullName,
      repoId: repo.id,
      orgId,
      prNumber: mrIid,
      prTitle,
      prUrl,
      prAuthor,
      headSha,
      triggerCommentId: commentId,
      triggerCommentBody: commentBody,
    });
  }

  return NextResponse.json({ ok: true });
}
