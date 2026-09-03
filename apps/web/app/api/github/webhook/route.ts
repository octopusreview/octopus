import "server-only";

import crypto from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@octopus/db";
import {
  addCommentReaction,
  getPullRequestDetails,
  createCheckRun,
  updateCheckRun,
} from "@/lib/github";
import { startReviewFlow } from "@/lib/webhook-shared";
import { getGithubAppConfig } from "@/lib/github-app-config";
import { syncOrgRepos } from "@/lib/repo-sync";
import {
  observeGithubWebhookDeliveryBestEffort,
  resolveGithubWebhookTenant,
  type GithubWebhookTenantResolution,
} from "@/lib/webhook-tenant";

type ResolvedGithubWebhookTenant = GithubWebhookTenantResolution & {
  status: "resolved";
  organizationId: string;
  repositoryId: string;
};

function isResolvedRepositoryTenant(
  resolution: GithubWebhookTenantResolution,
): resolution is ResolvedGithubWebhookTenant {
  return (
    resolution.status === "resolved" &&
    resolution.organizationId !== null &&
    resolution.repositoryId !== null
  );
}

async function verifySignature(payload: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const secret = (await getGithubAppConfig())?.webhookSecret;
  if (!secret) return false;

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(payload).digest("hex");

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;

  return crypto.timingSafeEqual(sigBuf, expBuf);
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!(await verifySignature(body, signature))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = request.headers.get("x-github-event");
  const deliveryId = request.headers.get("x-github-delivery");
  const payloadSha256 = crypto.createHash("sha256").update(body).digest("hex");
  const payload = JSON.parse(body);
  const tenantResolution = await resolveGithubWebhookTenant({
    provider: "github",
    installationId: payload.installation?.id,
    repositoryExternalId: payload.repository?.id,
  });
  const resolvedRepositoryTenant = isResolvedRepositoryTenant(tenantResolution)
    ? tenantResolution
    : null;

  // Record only after signature verification. Telemetry remains best-effort:
  // retries and GitHub's unsigned delivery ID never influence routing.
  after(async () => {
    await observeGithubWebhookDeliveryBestEffort({
      deliveryId,
      eventType: event,
      action: payload.action,
      payloadSha256,
      installationId: payload.installation?.id,
      repositoryExternalId: payload.repository?.id,
      tenantResolution,
    });
  });

  // A signature proves the GitHub App emitted the body; the installation ID
  // inside that signed body selects the tenant. Never route a repository event
  // through a provider/external-ID lookup that omits the selected organization.
  // `repository.created` arrives before the repo has a row (status
  // repository_not_owned); let repository lifecycle events through only when
  // the signed installation mapped to an organization. Unmapped stays dropped.
  const isRepositoryLifecycleEvent =
    event === "repository" && tenantResolution.organizationId !== null;
  if (
    payload.repository?.id !== undefined &&
    !resolvedRepositoryTenant &&
    !isRepositoryLifecycleEvent
  ) {
    console.warn(
      `[webhook] Dropping GitHub repository event: ${tenantResolution.status}`,
    );
    return NextResponse.json({ ok: true });
  }

  // ── Repository lifecycle (created / renamed / transferred / deleted) ──
  // A brand-new repository has no row yet, so re-list the installation through
  // the shared sync core instead of trusting payload fields. Orgs can opt out
  // of automatic discovery in Settings → Reviews.
  if (event === "repository") {
    const orgId = tenantResolution.organizationId;
    const action = String(payload.action ?? "");
    if (orgId && ["created", "renamed", "transferred", "deleted"].includes(action)) {
      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { autoDiscoverRepos: true },
      });
      if (org?.autoDiscoverRepos !== false) {
        try {
          await syncOrgRepos(orgId, { source: "webhook" });
          revalidatePath("/");
          revalidatePath("/repositories");
        } catch (err) {
          console.error("[webhook] repository sync failed:", err);
        }
      }
    }
    return NextResponse.json({ ok: true });
  }

  // Installation created/updated or repositories added/removed to it: one full
  // sync through the shared core (same end state as the old incremental path,
  // and it never resurrects repositories the user removed).
  if (
    (event === "installation" && payload.action !== "deleted") ||
    event === "installation_repositories"
  ) {
    const orgId = tenantResolution.organizationId;
    if (orgId) {
      try {
        await syncOrgRepos(orgId, { source: "webhook" });
        revalidatePath("/");
        revalidatePath("/repositories");
      } catch (err) {
        console.error("Webhook repo sync failed:", err);
      }
    }
  }

  if (event === "installation" && payload.action === "deleted") {
    const installationId = payload.installation?.id as number | undefined;
    if (installationId) {
      await prisma.organization.updateMany({
        where: { githubInstallationId: installationId },
        data: { githubInstallationId: null },
      });
    }
  }

  // ── PR opened / reopened / synchronize / ready_for_review → auto-review if repo has autoReview enabled ──
  // `ready_for_review` fires when a draft is marked ready; its payload has
  // draft:false, so the draft guard below passes it straight through.
  if (
    event === "pull_request" &&
    (payload.action === "opened" ||
      payload.action === "reopened" ||
      payload.action === "synchronize" ||
      payload.action === "ready_for_review")
  ) {
    const installationId = payload.installation?.id as number | undefined;
    if (!installationId) {
      return NextResponse.json({ ok: true });
    }
    if (!resolvedRepositoryTenant) {
      return NextResponse.json({ ok: true });
    }

    const repoFullName: string = payload.repository?.full_name ?? "";
    const repoExternalId = String(payload.repository?.id ?? "");
    const [owner, repoName] = repoFullName.split("/");
    const prNumber: number = payload.pull_request?.number;
    const prTitle: string = payload.pull_request?.title ?? `PR #${prNumber}`;
    const prUrl: string = payload.pull_request?.html_url ?? "";
    const prAuthor: string = payload.pull_request?.user?.login ?? "unknown";
    const headSha: string = payload.pull_request?.head?.sha ?? "";
    const isDraft: boolean = payload.pull_request?.draft === true;

    console.log(`[webhook] pull_request ${payload.action} — ${repoFullName}#${prNumber}`);

    // Find repository in DB and check autoReview
    const repo = await prisma.repository.findUnique({
      where: { id: resolvedRepositoryTenant.repositoryId },
      select: { id: true, organizationId: true, autoReview: true, installationId: true },
    });

    if (!repo || repo.organizationId !== resolvedRepositoryTenant.organizationId) {
      console.warn(`[webhook] Repo not found in DB — externalId: ${repoExternalId}`);
      return NextResponse.json({ ok: true });
    }

    // Update installationId on repo if it changed
    if (repo.installationId !== installationId) {
      await prisma.repository.update({
        where: { id: repo.id },
        data: { installationId },
      });
    }

    // Check if review should be skipped (autoReview off or blocked author)
    // If skipped, post a neutral check run so the PR isn't blocked forever
    const skipReview = async (reason: string) => {
      console.log(`[webhook] ${reason}, skipping PR #${prNumber}`);
      if (headSha) {
        try {
          const checkRunId = await createCheckRun(installationId, owner, repoName, headSha, "Octopus Review");
          await updateCheckRun(installationId, owner, repoName, checkRunId, "neutral", {
            title: "Review skipped",
            summary: reason,
          });
          console.log(`[webhook] Check run marked as neutral for PR #${prNumber}`);
        } catch (err) {
          console.warn(`[webhook] Failed to post neutral check run for PR #${prNumber}:`, err);
        }
      }
    };

    if (!repo.autoReview) {
      await skipReview(`Auto-review disabled for repo ${repoFullName}`);
      return NextResponse.json({ ok: true });
    }

    // Draft PRs are WIP by definition — skip auto-review (posts a neutral check
    // so the PR isn't left pending). The review fires on `ready_for_review`.
    // A manual @octopus mention still reviews a draft (explicit opt-in).
    if (isDraft) {
      await skipReview(`PR #${prNumber} is a draft`);
      return NextResponse.json({ ok: true });
    }

    // Check blocked authors before starting review
    const [org, systemConfig] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: repo.organizationId },
        select: { blockedAuthors: true },
      }),
      prisma.systemConfig.findUnique({
        where: { id: "singleton" },
        select: { blockedAuthors: true },
      }),
    ]);

    const globalBlocked = (systemConfig?.blockedAuthors as string[]) ?? [];
    const orgBlocked = (org?.blockedAuthors as string[]) ?? [];
    const authorLower = prAuthor.toLowerCase();
    const isBlocked = [...globalBlocked, ...orgBlocked].some(
      (b) => b.toLowerCase() === authorLower,
    );

    if (isBlocked) {
      await skipReview(`PR author "${prAuthor}" is in the blocked list`);
      return NextResponse.json({ ok: true });
    }

    console.log(`[webhook] Auto-review enabled — starting review for PR #${prNumber}`);

    await startReviewFlow({
      provider: "github",
      installationId,
      repoFullName,
      repoId: repo.id,
      orgId: repo.organizationId,
      prNumber,
      prTitle,
      prUrl,
      prAuthor,
      headSha,
      triggerCommentId: 0,
      triggerCommentBody: "",
    });

    console.log(`[webhook] ✅ Auto-review triggered for ${repoFullName}#${prNumber}`);
  }

  // ── PR merged → incremental re-index changed files ──
  if (
    event === "pull_request" &&
    payload.action === "closed" &&
    payload.pull_request?.merged === true
  ) {
    const prNumber: number = payload.pull_request?.number;
    const installationId = payload.installation?.id as number | undefined;

    if (!resolvedRepositoryTenant) {
      return NextResponse.json({ ok: true });
    }

    const repo = await prisma.repository.findUnique({
      where: { id: resolvedRepositoryTenant.repositoryId },
      select: { id: true, fullName: true, defaultBranch: true, indexStatus: true, organizationId: true },
    });

    if (repo && repo.organizationId === resolvedRepositoryTenant.organizationId) {
      await prisma.pullRequest.updateMany({
        where: { repositoryId: repo.id, number: prNumber },
        data: { mergedAt: new Date() },
      });

      // Incremental index: only re-index files changed in this PR
      if (repo.indexStatus === "indexed" && installationId) {
        try {
          const { getInstallationToken } = await import("@/lib/github");
          const token = await getInstallationToken(installationId);
          const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
          let page = 1;
          const files: { filename: string; status: string }[] = [];
          while (true) {
            const res = await fetch(
              `https://api.github.com/repos/${repo.fullName}/pulls/${prNumber}/files?per_page=100&page=${page}`,
              { headers },
            );
            if (!res.ok) break;
            const batch = await res.json() as { filename: string; status: string }[];
            if (batch.length === 0) break;
            files.push(...batch);
            if (batch.length < 100) break;
            page++;
          }
          if (files.length > 0) {
            const { incrementalIndex } = await import("@/lib/indexer");
            const result = await incrementalIndex(
              repo.id,
              repo.fullName,
              repo.defaultBranch,
              installationId,
              files,
              "github",
              repo.organizationId,
            );
            await prisma.repository.update({
              where: { id: repo.id },
              data: { indexedAt: new Date(), indexStatus: "indexed" },
            });
            console.log(`[webhook] PR #${prNumber} merged — incremental index: ${result.updatedFiles} updated, ${result.removedFiles} removed, ${result.newVectors} vectors`);
          } else {
            // Fallback: mark as stale if we can't get file list
            await prisma.repository.update({ where: { id: repo.id }, data: { indexStatus: "stale" } });
            console.log(`[webhook] PR #${prNumber} merged, no changed files found via API, marked as stale`);
          }
        } catch (err) {
          // Fallback: mark as stale on any error
          await prisma.repository.update({ where: { id: repo.id }, data: { indexStatus: "stale" } });
          console.warn(`[webhook] PR #${prNumber} incremental index failed, marked as stale:`, err);
        }
      } else {
        // Repo not yet indexed or no installation — mark as stale for full re-index on next review
        if (repo.indexStatus !== "indexed") {
          console.log(`[webhook] PR #${prNumber} merged, repo not yet indexed (${repo.indexStatus}), skipping incremental`);
        } else {
          await prisma.repository.update({ where: { id: repo.id }, data: { indexStatus: "stale" } });
          console.log(`[webhook] PR #${prNumber} merged, no installationId, marked as stale`);
        }
      }
    }
  }

  // ── @octopus mention in PR comment → start review ──
  if (event === "issue_comment" && payload.action === "created") {
    const commentBody: string = payload.comment?.body ?? "";
    const isPr = !!payload.issue?.pull_request;
    const mentionsOctopus = /@octopus(?:review|-review)?\b/i.test(commentBody);

    // Detect comments authored by our own GitHub App so we don't process
    // placeholder/review comments we just posted as if they were user input.
    // Primary signal: performed_via_github_app.id matches our app. Fallback:
    // comment author is a Bot whose login matches our app slug (covers old
    // payloads or edge cases where performed_via_github_app is absent).
    const commentId: number = payload.comment?.id;
    const appConfig = await getGithubAppConfig();
    const ownAppId = appConfig?.appId;
    const viaAppId = payload.comment?.performed_via_github_app?.id;
    const authorType: string | undefined = payload.comment?.user?.type;
    const authorLogin: string = payload.comment?.user?.login ?? "";
    const appSlug = appConfig?.slug ?? "";
    const isOwnApp = !!ownAppId && viaAppId != null && String(viaAppId) === String(ownAppId);
    const isOwnBotLogin =
      authorType === "Bot" && !!appSlug && authorLogin.toLowerCase() === `${appSlug}[bot]`.toLowerCase();
    const isOwnComment = isOwnApp || isOwnBotLogin;

    if (isOwnComment) {
      console.log(`[webhook] issue_comment: own comment (Octopus bot), ignoring — commentId: ${commentId}`);
      return NextResponse.json({ ok: true });
    }

    console.log(`[webhook] issue_comment received — isPR: ${isPr}, mentionsOctopus: ${mentionsOctopus}, comment: "${commentBody.slice(0, 100)}"`);

    if (isPr && mentionsOctopus) {
      const installationId = payload.installation?.id as number | undefined;
      if (!installationId) {
        console.warn("[webhook] No installationId found, skipping");
        return NextResponse.json({ ok: true });
      }
      if (!resolvedRepositoryTenant) {
        return NextResponse.json({ ok: true });
      }

      const repoFullName: string = payload.repository?.full_name ?? "";
      const repoExternalId = String(payload.repository?.id ?? "");
      const [owner, repoName] = repoFullName.split("/");
      const prNumber: number = payload.issue?.number;

      console.log(`[webhook] @octopus mention detected — repo: ${repoFullName}, PR #${prNumber}, commentId: ${commentId}, installationId: ${installationId}`);

      // Find repository in DB
      const repo = await prisma.repository.findUnique({
        where: { id: resolvedRepositoryTenant.repositoryId },
        select: { id: true, organizationId: true, installationId: true },
      });

      if (!repo || repo.organizationId !== resolvedRepositoryTenant.organizationId) {
        console.warn(`[webhook] Repo not found in DB — externalId: ${repoExternalId}, fullName: ${repoFullName}`);
        return NextResponse.json({ ok: true });
      }

      // Update installationId on repo if it changed
      if (repo.installationId !== installationId) {
        await prisma.repository.update({
          where: { id: repo.id },
          data: { installationId },
        });
      }

      console.log(`[webhook] Repo found in DB — repoId: ${repo.id}, orgId: ${repo.organizationId}`);

      // Get PR details from GitHub API, fallback to payload
      let prTitle = payload.issue?.title ?? `PR #${prNumber}`;
      let prUrl = payload.issue?.html_url ?? "";
      let prAuthor = payload.issue?.user?.login ?? "unknown";
      let headSha = "";

      try {
        console.log(`[webhook] Fetching PR details from GitHub API — ${owner}/${repoName}#${prNumber}`);
        const details = await getPullRequestDetails(installationId, owner, repoName, prNumber);
        prTitle = details.title;
        prUrl = details.url;
        prAuthor = details.author;
        headSha = details.headSha;
        console.log(`[webhook] PR details fetched — title: "${prTitle}", author: ${prAuthor}, sha: ${headSha.slice(0, 7)}`);
      } catch (err) {
        console.warn("[webhook] Failed to fetch PR details, using payload fallback:", err);
      }

      // Add 👀 reaction to the comment
      console.log(`[webhook] Adding 👀 reaction to comment ${commentId}`);
      addCommentReaction(installationId, owner, repoName, commentId, "eyes")
        .then(() => console.log(`[webhook] 👀 reaction added successfully`))
        .catch((err) => console.error("[webhook] Failed to add reaction:", err));

      await startReviewFlow({
        provider: "github",
        installationId,
        repoFullName,
        repoId: repo.id,
        orgId: repo.organizationId,
        prNumber,
        prTitle,
        prUrl,
        prAuthor,
        headSha,
        triggerCommentId: commentId,
        triggerCommentBody: commentBody,
      });

      console.log(`[webhook] ✅ Review flow complete for ${repoFullName}#${prNumber}`);
    }
  }

  return NextResponse.json({ ok: true });
}
