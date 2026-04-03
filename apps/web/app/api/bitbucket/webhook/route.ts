import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { getPullRequestDetails } from "@/lib/bitbucket";
import { startReviewFlow } from "@/lib/webhook-shared";

function verifySignature(
  payload: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  // Bitbucket sends signature as "sha256=<hex>" — strip the prefix
  const sigHex = signature.startsWith("sha256=")
    ? signature.slice("sha256=".length)
    : signature;

  // timingSafeEqual requires equal-length buffers
  const sigBuf = Buffer.from(sigHex);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;

  return crypto.timingSafeEqual(sigBuf, expBuf);
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const event = request.headers.get("x-event-key");
  const signature = request.headers.get("x-hub-signature");

  if (!event) {
    return NextResponse.json({ error: "Missing event header" }, { status: 400 });
  }

  // Parse payload safely
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  // Determine workspace from payload
  const repository = payload.repository as Record<string, unknown> | undefined;
  const repoFullName = (repository?.full_name as string) ?? "";
  const [workspace] = repoFullName.split("/");

  if (!workspace) {
    return NextResponse.json({ error: "Missing repository workspace" }, { status: 400 });
  }

  // Find integration by workspace slug
  const integration = await prisma.bitbucketIntegration.findFirst({
    where: { workspaceSlug: workspace },
    select: {
      id: true,
      organizationId: true,
      webhookSecret: true,
    },
  });

  if (!integration) {
    console.warn(`[bitbucket-webhook] No integration found for workspace: ${workspace}`);
    return NextResponse.json({ error: "Unknown workspace" }, { status: 404 });
  }

  // Always verify signature — reject if no secret is configured
  if (!integration.webhookSecret) {
    console.error(`[bitbucket-webhook] No webhook secret configured for workspace: ${workspace}`);
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  if (!verifySignature(body, signature, integration.webhookSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const orgId = integration.organizationId;

  // ── PR created / updated → auto-review if repo has autoReview enabled ──
  if (event === "pullrequest:created" || event === "pullrequest:updated") {
    const repoUuid = (repository?.uuid as string) ?? "";
    const pullrequest = payload.pullrequest as Record<string, unknown> | undefined;
    const prId = pullrequest?.id as number | undefined;

    if (!repoUuid || !prId || typeof prId !== "number") {
      console.warn(`[bitbucket-webhook] Invalid payload — repoUuid: ${repoUuid}, prId: ${prId}`);
      return NextResponse.json({ error: "Invalid payload: missing repository uuid or PR id" }, { status: 400 });
    }

    const prAuthorObj = pullrequest?.author as Record<string, string> | undefined;
    const prSourceObj = pullrequest?.source as Record<string, Record<string, string>> | undefined;
    const prLinksObj = pullrequest?.links as Record<string, Record<string, string>> | undefined;

    const prTitle = (pullrequest?.title as string) ?? `PR #${prId}`;
    const prUrl = prLinksObj?.html?.href ?? "";
    const prAuthor = prAuthorObj?.display_name ?? prAuthorObj?.nickname ?? "unknown";
    const headSha = prSourceObj?.commit?.hash ?? "";

    console.log(`[bitbucket-webhook] ${event} — ${repoFullName}#${prId}`);

    const repo = await prisma.repository.findUnique({
      where: {
        provider_externalId: { provider: "bitbucket", externalId: repoUuid },
      },
      select: { id: true, organizationId: true, autoReview: true },
    });

    if (!repo) {
      console.warn(`[bitbucket-webhook] Repo not found — uuid: ${repoUuid}`);
      return NextResponse.json({ ok: true });
    }

    if (!repo.autoReview) {
      console.log(`[bitbucket-webhook] Auto-review disabled for ${repoFullName}, skipping`);
      return NextResponse.json({ ok: true });
    }

    await startReviewFlow({
      provider: "bitbucket",
      organizationId: orgId,
      repoFullName,
      repoId: repo.id,
      orgId: repo.organizationId,
      prNumber: prId,
      prTitle,
      prUrl,
      prAuthor,
      headSha,
      triggerCommentId: 0,
      triggerCommentBody: "",
    });

    console.log(`[bitbucket-webhook] Auto-review triggered for ${repoFullName}#${prId}`);
  }

  // ── PR merged → mark as merged ──
  if (event === "pullrequest:fulfilled") {
    const repoUuid = (repository?.uuid as string) ?? "";
    const pullrequest = payload.pullrequest as Record<string, unknown> | undefined;
    const prId = pullrequest?.id as number | undefined;

    if (repoUuid && prId && typeof prId === "number") {
      const repo = await prisma.repository.findUnique({
        where: {
          provider_externalId: { provider: "bitbucket", externalId: repoUuid },
        },
        select: { id: true },
      });

      if (repo) {
        await Promise.all([
          prisma.pullRequest.updateMany({
            where: { repositoryId: repo.id, number: prId },
            data: { mergedAt: new Date() },
          }),
          // Mark repo index as stale — will be re-indexed on next PR review
          prisma.repository.update({
            where: { id: repo.id },
            data: { indexStatus: "stale" },
          }),
        ]);
        console.log(`[bitbucket-webhook] PR #${prId} merged, repo index marked as stale`);
      }
    }
  }

  // ── @octopus mention in PR comment ──
  if (event === "pullrequest:comment_created") {
    const comment = payload.comment as Record<string, unknown> | undefined;
    const content = comment?.content as Record<string, string> | undefined;
    const commentBody = content?.raw ?? content?.markup ?? "";
    const mentionsOctopus = /@octopus\b/i.test(commentBody);

    if (mentionsOctopus) {
      const repoUuid = (repository?.uuid as string) ?? "";
      const pullrequest = payload.pullrequest as Record<string, unknown> | undefined;
      const prId = pullrequest?.id as number | undefined;
      const commentId = (comment?.id as number) ?? 0;

      if (!repoUuid || !prId || typeof prId !== "number") {
        console.warn(`[bitbucket-webhook] Invalid mention payload — repoUuid: ${repoUuid}, prId: ${prId}`);
        return NextResponse.json({ error: "Invalid payload: missing repository uuid or PR id" }, { status: 400 });
      }

      console.log(`[bitbucket-webhook] @octopus mention — ${repoFullName}#${prId}`);

      const repo = await prisma.repository.findUnique({
        where: {
          provider_externalId: { provider: "bitbucket", externalId: repoUuid },
        },
        select: { id: true, organizationId: true },
      });

      if (!repo) {
        console.warn(`[bitbucket-webhook] Repo not found — uuid: ${repoUuid}`);
        return NextResponse.json({ ok: true });
      }

      // Fetch full PR details
      const [ws, repoSlug] = repoFullName.split("/");
      const prAuthorObj = pullrequest?.author as Record<string, string> | undefined;
      const prSourceObj = pullrequest?.source as Record<string, Record<string, string>> | undefined;
      const prLinksObj = pullrequest?.links as Record<string, Record<string, string>> | undefined;

      let prTitle = (pullrequest?.title as string) ?? `PR #${prId}`;
      let prUrl = prLinksObj?.html?.href ?? "";
      let prAuthor = prAuthorObj?.display_name ?? "unknown";
      let headSha = prSourceObj?.commit?.hash ?? "";

      if (ws && repoSlug) {
        try {
          const details = await getPullRequestDetails(orgId, ws, repoSlug, prId);
          prTitle = details.title;
          prUrl = details.url;
          prAuthor = details.author;
          headSha = details.headSha;
        } catch (err) {
          console.warn("[bitbucket-webhook] Failed to fetch PR details:", err);
        }
      }

      await startReviewFlow({
        provider: "bitbucket",
        organizationId: orgId,
        repoFullName,
        repoId: repo.id,
        orgId: repo.organizationId,
        prNumber: prId,
        prTitle,
        prUrl,
        prAuthor,
        headSha,
        triggerCommentId: commentId,
        triggerCommentBody: commentBody,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
