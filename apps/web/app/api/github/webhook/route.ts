import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@octopus/db";
import {
  listInstallationRepos,
  addCommentReaction,
  getPullRequestDetails,
  createCheckRun,
  updateCheckRun,
} from "@/lib/github";
import { startReviewFlow } from "@/lib/webhook-shared";

function verifySignature(payload: string, signature: string | null): boolean {
  if (!signature) return false;
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
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

  if (!verifySignature(body, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = request.headers.get("x-github-event");
  const payload = JSON.parse(body);

  if (event === "installation" || event === "installation_repositories") {
    const installationId = payload.installation?.id as number | undefined;
    if (!installationId) {
      return NextResponse.json({ ok: true });
    }

    // Find the org linked to this installation
    const org = await prisma.organization.findFirst({
      where: { githubInstallationId: installationId },
      select: { id: true },
    });

    if (!org) {
      return NextResponse.json({ ok: true });
    }

    // Sync repos from GitHub
    try {
      if (event === "installation_repositories") {
        // Incremental sync: only add/remove repos that changed
        const added = (payload.repositories_added ?? []) as { id: number; name: string; full_name: string; default_branch?: string }[];
        const removed = (payload.repositories_removed ?? []) as { id: number }[];

        for (const repo of added) {
          await prisma.repository.upsert({
            where: {
              provider_externalId_organizationId: {
                provider: "github",
                externalId: String(repo.id),
                organizationId: org.id,
              },
            },
            create: {
              name: repo.name,
              fullName: repo.full_name,
              externalId: String(repo.id),
              defaultBranch: repo.default_branch ?? "main",
              provider: "github",
              isActive: true,
              installationId,
              organizationId: org.id,
            },
            update: {
              name: repo.name,
              fullName: repo.full_name,
              defaultBranch: repo.default_branch ?? "main",
              isActive: true,
              installationId,
              organizationId: org.id,
            },
          });
        }

        if (removed.length > 0) {
          await prisma.repository.updateMany({
            where: {
              organizationId: org.id,
              provider: "github",
              externalId: { in: removed.map((r) => String(r.id)) },
            },
            data: { isActive: false },
          });
        }
      } else {
        // Full sync on installation created/updated
        const ghRepos = await listInstallationRepos(installationId);

        for (const repo of ghRepos) {
          await prisma.repository.upsert({
            where: {
              provider_externalId_organizationId: {
                provider: "github",
                externalId: String(repo.id),
                organizationId: org.id,
              },
            },
            create: {
              name: repo.name,
              fullName: repo.full_name,
              externalId: String(repo.id),
              defaultBranch: repo.default_branch,
              provider: "github",
              isActive: true,
              installationId,
              organizationId: org.id,
            },
            update: {
              name: repo.name,
              fullName: repo.full_name,
              defaultBranch: repo.default_branch,
              isActive: true,
              installationId,
              organizationId: org.id,
            },
          });
        }
      }

      revalidatePath("/");
      revalidatePath("/repositories");
    } catch (err) {
      console.error("Webhook repo sync failed:", err);
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

  // ── PR opened / reopened / synchronize → auto-review if repo has autoReview enabled ──
  if (
    event === "pull_request" &&
    (payload.action === "opened" || payload.action === "reopened" || payload.action === "synchronize")
  ) {
    const installationId = payload.installation?.id as number | undefined;
    if (!installationId) {
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

    console.log(`[webhook] pull_request ${payload.action} — ${repoFullName}#${prNumber}`);

    // Find repository in DB and check autoReview
    const repo = await prisma.repository.findFirst({
      where: { provider: "github", externalId: repoExternalId },
      select: { id: true, organizationId: true, autoReview: true, installationId: true },
    });

    if (!repo) {
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
    const repoExternalId = String(payload.repository?.id ?? "");
    const prNumber: number = payload.pull_request?.number;
    const installationId = payload.installation?.id as number | undefined;

    const repo = await prisma.repository.findFirst({
      where: { provider: "github", externalId: repoExternalId },
      select: { id: true, fullName: true, defaultBranch: true, indexStatus: true, organizationId: true },
    });

    if (repo) {
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
    const ownAppId = process.env.GITHUB_APP_ID;
    const viaAppId = payload.comment?.performed_via_github_app?.id;
    const authorType: string | undefined = payload.comment?.user?.type;
    const authorLogin: string = payload.comment?.user?.login ?? "";
    const appSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG ?? "";
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

      const repoFullName: string = payload.repository?.full_name ?? "";
      const repoExternalId = String(payload.repository?.id ?? "");
      const [owner, repoName] = repoFullName.split("/");
      const prNumber: number = payload.issue?.number;

      console.log(`[webhook] @octopus mention detected — repo: ${repoFullName}, PR #${prNumber}, commentId: ${commentId}, installationId: ${installationId}`);

      // Find repository in DB
      const repo = await prisma.repository.findFirst({
        where: { provider: "github", externalId: repoExternalId },
        select: { id: true, organizationId: true, installationId: true },
      });

      if (!repo) {
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
