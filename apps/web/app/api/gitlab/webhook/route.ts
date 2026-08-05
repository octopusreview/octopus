import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { getPullRequestDetails } from "@/lib/gitlab";
import { startReviewFlow } from "@/lib/webhook-shared";
import {
  resolveGitlabWebhookIntegration,
  resolveGitlabWebhookTenant,
} from "@/lib/webhook-tenant";

export async function POST(request: NextRequest) {
  const event = request.headers.get("x-gitlab-event");
  const tokenHeader = request.headers.get("x-gitlab-token");

  if (!event) {
    return NextResponse.json({ error: "Missing event header" }, { status: 400 });
  }

  // Authenticate the tenant boundary before buffering or parsing an
  // attacker-controlled request body.
  const integrationResolution = await resolveGitlabWebhookIntegration({
    provider: "gitlab",
    token: tokenHeader,
  });
  if (
    integrationResolution.status !== "resolved" ||
    !integrationResolution.organizationId
  ) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const body = await request.text();

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

  // The per-organization hook secret selects the tenant before the project ID
  // is resolved through the provider/external-ID/organization compound key.
  const tenantResolution = await resolveGitlabWebhookTenant({
    provider: "gitlab",
    organizationId: integrationResolution.organizationId,
    repositoryExternalId: projectId,
  });
  if (
    tenantResolution.status !== "resolved" ||
    !tenantResolution.organizationId ||
    !tenantResolution.repository
  ) {
    console.warn(
      `[gitlab-webhook] Dropping project ${projectId}: ${tenantResolution.status}`,
    );
    return NextResponse.json({ ok: true });
  }

  const repo = tenantResolution.repository;

  const orgId = tenantResolution.organizationId;
  const repoFullName = repo.fullName;

  // ── Merge Request open/update → auto-review ──
  if (event === "Merge Request Hook") {
    const objectAttrs = payload.object_attributes as Record<string, unknown> | undefined;
    const action = objectAttrs?.action as string | undefined;
    const state = objectAttrs?.state as string | undefined;
    const isReviewAction =
      action === "open" || action === "reopen" || action === "update";
    const hasNewCommits = action !== "update" || Boolean(objectAttrs?.oldrev);
    const isOpen = state !== "merged" && state !== "closed";

    if (objectAttrs && isReviewAction && hasNewCommits && isOpen) {
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
      return NextResponse.json({ ok: true });
    }
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
        prisma.repository.updateMany({
          where: { id: repo.id, indexStatus: "indexed" },
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
