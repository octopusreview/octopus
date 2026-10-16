import "server-only";
import { recordReviewAdmissionAfterCommit } from "@/lib/review-attempt-outcome";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { prisma, type Prisma } from "@octopus/db";
import { z } from "zod";
import { getPullRequestDetails, runWithForgejoRepository } from "@/lib/forgejo";
import { startReviewFlow } from "@/lib/webhook-shared";

const id = z.number().int().positive().safe();
const payloadSchema = z.object({
  action: z.string().max(64).optional(),
  changes: z.object({ title: z.object({ from: z.string().max(100_000) }).optional() }).optional(),
  repository: z.object({ id, full_name: z.string().max(512) }),
  pull_request: z.object({ number: id, head: z.object({ sha: z.string().regex(/^[a-f0-9]{40,64}$/i) }) }).optional(),
  issue: z.object({ number: id, pull_request: z.object({}).optional() }).optional(),
  comment: z.object({ id, body: z.string().max(100_000), user: z.object({ login: z.string().max(255) }) }).optional(),
});

async function readBody(request: Request): Promise<Buffer> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) throw new Error("Payload too large");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ integrationId: string }> }) {
  const { integrationId } = await params;
  const signature = request.headers.get("x-forgejo-signature") ?? "";
  if (integrationId.length > 128 || !/^[a-f0-9]{64}$/i.test(signature)) {
    return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
  }
  const integration = await prisma.forgejoIntegration.findUnique({
    where: { id: integrationId },
    select: { organizationId: true, forgejoHost: true, username: true, webhookSecret: true },
  });
  if (!integration) return Response.json({ error: "Invalid webhook signature" }, { status: 401 });

  let raw: Buffer;
  try { raw = await readBody(request); }
  catch { return Response.json({ error: "Missing or oversized payload" }, { status: 413 }); }
  const expected = createHmac("sha256", integration.webhookSecret).update(raw).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) {
    return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
  }
  let payload: z.infer<typeof payloadSchema>;
  try { payload = payloadSchema.parse(JSON.parse(raw.toString("utf8"))); }
  catch { return Response.json({ error: "Invalid webhook payload" }, { status: 400 }); }

  const repo = await prisma.repository.findUnique({
    where: { provider_externalId_organizationId: {
      provider: "forgejo", externalId: `${integration.forgejoHost}:${payload.repository.id}`,
      organizationId: integration.organizationId,
    } },
    select: { id: true, fullName: true, autoReview: true, isActive: true, dismissedAt: true },
  });
  if (!repo?.isActive || repo.dismissedAt || repo.fullName !== payload.repository.full_name) {
    return Response.json({ ok: true, ignored: true });
  }

  const event = request.headers.get("x-forgejo-event");
  const titleChanged = event === "pull_request" && payload.action === "edited" && payload.changes?.title !== undefined;
  const automatic = event === "pull_request" && (["opened", "reopened", "synchronized"].includes(payload.action ?? "") || titleChanged);
  const merged = event === "pull_request" && payload.action === "closed";
  const mention = event === "issue_comment" && payload.action === "created"
    && payload.issue?.pull_request && payload.comment
    && payload.comment.user.login.toLowerCase() !== integration.username.toLowerCase()
    && /(?:^|\s)(?:@octopus|\/octopus)(?=$|\s|[.,!?:;](?=$|\s))/i.test(payload.comment.body);
  if ((!automatic || !repo.autoReview) && !mention && !merged) return Response.json({ ok: true, ignored: true });
  const number = mention ? payload.issue?.number : payload.pull_request?.number;
  if (!number) return Response.json({ error: "Missing pull request number" }, { status: 400 });

  // The signed bytes identify a delivery, even if a sender changes the unsigned
  // delivery header. Namespace by integration so tenants never suppress each other.
  const payloadSha256 = createHash("sha256").update(raw).digest("hex");
  const deliveryId = `${integrationId}:${payloadSha256}`;
  const where = { provider_deliveryId: { provider: "forgejo", deliveryId } };
  if (await prisma.webhookDelivery.findUnique({ where, select: { id: true } })) {
    return Response.json({ ok: true, duplicate: true });
  }

  // Read metadata from the configured instance, never from payload URLs. Shared
  // admission checks the head again before a billable review can be queued.
  const details = await runWithForgejoRepository(repo.id, () => getPullRequestDetails(integration.organizationId, repo.fullName, number));
  let admittedReviewId: string | undefined;
  const response = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${`forgejo:${deliveryId}`}, 0)) AS acquired`;
    if (!lock.acquired) return Response.json({ retryable: true }, { status: 503, headers: { "Retry-After": "180" } });
    if (await tx.webhookDelivery.findUnique({ where, select: { id: true } })) {
      return Response.json({ ok: true, duplicate: true });
    }
    if (merged) {
      if (details.merged) {
        await prisma.$transaction([
          prisma.pullRequest.updateMany({ where: { repositoryId: repo.id, number }, data: { mergedAt: new Date() } }),
          prisma.repository.updateMany({ where: { id: repo.id, indexStatus: "indexed" }, data: { indexStatus: "stale" } }),
        ]);
      }
    } else if (details.state === "open" && !details.draft) {
      const outcome = await startReviewFlow({
        provider: "forgejo", automatic, organizationId: integration.organizationId, orgId: integration.organizationId,
        repoId: repo.id, repoFullName: repo.fullName, prNumber: number,
        prTitle: details.title, prUrl: details.url, prAuthor: details.author,
        headSha: automatic ? payload.pull_request!.head.sha : details.headSha,
        triggerCommentId: mention ? payload.comment!.id : 0,
        triggerCommentBody: mention ? payload.comment!.body : "",
      }, tx);
      if (outcome.started) admittedReviewId = outcome.pullRequestId;
      if (!outcome.started && ["already_in_progress", "head_unavailable", "request_contended"].includes(outcome.reason)) {
        // Another delivery may still be enqueueing, or a restart may have left a
        // pending admission with no durable job. Never permanently acknowledge it.
        return Response.json({ error: outcome.message, retryable: true }, { status: 503, headers: { "Retry-After": "180" } });
      }
    }

    await tx.webhookDelivery.upsert({ where, update: {}, create: {
      provider: "forgejo", deliveryId, deliveryIdSource: "payload_sha256", payloadSha256,
      eventType: event!, action: payload.action,
      providerRepositoryId: String(payload.repository.id),
      resolvedOrganizationId: integration.organizationId, resolvedRepositoryId: repo.id,
      resolutionStatus: "resolved", comparisonStatus: "not_compared",
    } });
    return Response.json({ ok: true });
  }, { timeout: 120_000 });
  if (admittedReviewId) recordReviewAdmissionAfterCommit(admittedReviewId, null);
  return response;
}
