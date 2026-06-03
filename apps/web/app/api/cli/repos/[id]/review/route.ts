import { authenticateApiToken } from "@/lib/api-auth";
import { prisma } from "@octopus/db";
import { processReview } from "@/lib/reviewer";
import * as github from "@/lib/github";
import * as gitlab from "@/lib/gitlab";
import * as bitbucket from "@/lib/bitbucket";
import { startReviewFlow } from "@/lib/webhook-shared";
import { NextRequest } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await authenticateApiToken(request);
  if (!result) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const repo = await prisma.repository.findFirst({
    where: { id, organizationId: result.org.id, isActive: true },
  });

  if (!repo) {
    return Response.json({ error: "Repository not found" }, { status: 404 });
  }

  const { prNumber } = await request.json();
  if (!prNumber) {
    return Response.json({ error: "Missing prNumber" }, { status: 400 });
  }

  // Provider-aware wording: GitLab calls them "merge requests".
  const prLabel = repo.provider === "gitlab" ? "Merge request" : "Pull request";

  const pr = await prisma.pullRequest.findFirst({
    where: { repositoryId: repo.id, number: prNumber },
  });

  if (!pr) {
    // On-demand: the PR/MR exists on the provider but isn't synced into our DB yet
    // (e.g. opened before the repo was connected, so no webhook ever fired for it).
    // Fetch it straight from the provider API and kick off the full review flow.
    const parts = repo.fullName.split("/");
    if (parts.length < 2) {
      return Response.json({ error: "Invalid repository name" }, { status: 500 });
    }
    const [owner, repoName] = parts;
    try {
      let details;
      if (repo.provider === "github") {
        if (!repo.installationId) throw new Error("Missing installation id");
        details = await github.getPullRequestDetails(repo.installationId, owner, repoName, prNumber);
      } else if (repo.provider === "gitlab") {
        details = await gitlab.getPullRequestDetails(result.org.id, repo.fullName, prNumber);
      } else if (repo.provider === "bitbucket") {
        details = await bitbucket.getPullRequestDetails(result.org.id, owner, repoName, prNumber);
      } else {
        return Response.json({ error: `${prLabel} not found` }, { status: 404 });
      }

      await startReviewFlow({
        provider: repo.provider as "github" | "gitlab" | "bitbucket",
        installationId: repo.installationId ?? undefined,
        organizationId: result.org.id,
        repoFullName: repo.fullName,
        repoId: repo.id,
        orgId: result.org.id,
        prNumber: details.number,
        prTitle: details.title,
        prUrl: details.url,
        prAuthor: details.author,
        headSha: details.headSha,
        triggerCommentId: 0,
        triggerCommentBody: "",
      });

      return Response.json({ message: "Review started", prNumber: details.number });
    } catch (err) {
      console.error(`[cli] Failed to fetch ${repo.provider} ${prLabel} #${prNumber}:`, err);
      return Response.json({ error: `${prLabel} not found` }, { status: 404 });
    }
  }

  if (pr.status === "reviewing") {
    return Response.json({ error: "Review already in progress" }, { status: 409 });
  }

  // Start review in the background
  processReview(pr.id).catch((err) => {
    console.error(`[cli] Review failed for PR #${prNumber}:`, err);
  });

  return Response.json({
    message: "Review started",
    pullRequestId: pr.id,
    prNumber: pr.number,
  });
}
