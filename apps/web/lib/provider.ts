import { prisma } from "@octopus/db";
import * as github from "@/lib/github";
import * as bitbucket from "@/lib/bitbucket";
import * as gitlab from "@/lib/gitlab";
import type { ReviewComment } from "@/lib/github";

export interface ProviderClient {
  getPullRequestDiff(prNumber: number): Promise<string>;
  createPullRequestComment(prNumber: number, body: string): Promise<number>;
  updatePullRequestComment(commentId: number, body: string, prNumber?: number): Promise<void>;
  createPullRequestReview(
    prNumber: number,
    body: string,
    event: "COMMENT" | "REQUEST_CHANGES" | "APPROVE",
    comments: ReviewComment[],
  ): Promise<number>;
  createCheckRun(
    headSha: string,
    name: string,
    detailsUrl?: string,
  ): Promise<number | null>;
  updateCheckRun(
    checkRunId: number,
    conclusion: "success" | "failure" | "neutral",
    output: { title: string; summary: string },
  ): Promise<void>;
  getRepositoryTree(branch: string): Promise<string[]>;
  getFileContent(branch: string, filePath: string): Promise<string>;
}

class GitHubProviderClient implements ProviderClient {
  constructor(
    private installationId: number,
    private owner: string,
    private repo: string,
  ) {}

  async getPullRequestDiff(prNumber: number) {
    return github.getPullRequestDiff(this.installationId, this.owner, this.repo, prNumber);
  }

  async createPullRequestComment(prNumber: number, body: string) {
    return github.createPullRequestComment(this.installationId, this.owner, this.repo, prNumber, body);
  }

  async updatePullRequestComment(commentId: number, body: string, _prNumber?: number) {
    return github.updatePullRequestComment(this.installationId, this.owner, this.repo, commentId, body);
  }

  async createPullRequestReview(
    prNumber: number,
    body: string,
    event: "COMMENT" | "REQUEST_CHANGES" | "APPROVE",
    comments: ReviewComment[],
  ) {
    return github.createPullRequestReview(
      this.installationId, this.owner, this.repo, prNumber, body, event, comments,
    );
  }

  async createCheckRun(headSha: string, name: string, detailsUrl?: string) {
    return github.createCheckRun(this.installationId, this.owner, this.repo, headSha, name, detailsUrl);
  }

  async updateCheckRun(
    checkRunId: number,
    conclusion: "success" | "failure" | "neutral",
    output: { title: string; summary: string },
  ) {
    return github.updateCheckRun(this.installationId, this.owner, this.repo, checkRunId, conclusion, output);
  }

  async getRepositoryTree(branch: string) {
    return github.getRepositoryTree(this.installationId, this.owner, this.repo, branch);
  }

  async getFileContent(branch: string, filePath: string) {
    const token = await github.getInstallationToken(this.installationId);
    const res = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/git/blobs/${filePath}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.raw+json",
        },
      },
    );
    if (!res.ok) throw new Error(`Failed to get file content: ${res.status}`);
    return res.text();
  }
}

class BitbucketProviderClient implements ProviderClient {
  constructor(
    private organizationId: string,
    private workspace: string,
    private repoSlug: string,
  ) {}

  async getPullRequestDiff(prNumber: number) {
    return bitbucket.getPullRequestDiff(this.organizationId, this.workspace, this.repoSlug, prNumber);
  }

  async createPullRequestComment(prNumber: number, body: string) {
    return bitbucket.createPullRequestComment(this.organizationId, this.workspace, this.repoSlug, prNumber, body);
  }

  async updatePullRequestComment(commentId: number, body: string, prNumber?: number) {
    if (!prNumber) {
      throw new Error("Bitbucket requires prNumber to update a comment");
    }
    return bitbucket.updatePullRequestComment(
      this.organizationId, this.workspace, this.repoSlug, prNumber, commentId, body,
    );
  }

  async createPullRequestReview(
    prNumber: number,
    body: string,
    _event: "COMMENT" | "REQUEST_CHANGES" | "APPROVE",
    comments: ReviewComment[],
  ) {
    // Bitbucket doesn't have a single review submission API like GitHub.
    // Post inline comments individually, then a summary comment.
    for (const comment of comments) {
      try {
        await bitbucket.createInlineComment(
          this.organizationId,
          this.workspace,
          this.repoSlug,
          prNumber,
          comment.path,
          comment.line,
          comment.body,
        );
      } catch (err) {
        console.error(`[bitbucket] Failed to post inline comment on ${comment.path}:${comment.line}:`, err);
      }
    }

    // Post summary comment
    if (body) {
      const commentId = await bitbucket.createPullRequestComment(
        this.organizationId,
        this.workspace,
        this.repoSlug,
        prNumber,
        body,
      );
      return commentId;
    }
    return 0;
  }

  async createCheckRun(): Promise<number | null> {
    // Bitbucket doesn't have a checks API — return null
    return null;
  }

  async updateCheckRun(): Promise<void> {
    // No-op for Bitbucket
  }

  async getRepositoryTree(branch: string) {
    return bitbucket.getRepositoryTree(this.organizationId, this.workspace, this.repoSlug, branch);
  }

  async getFileContent(branch: string, filePath: string) {
    return bitbucket.getFileContent(this.organizationId, this.workspace, this.repoSlug, branch, filePath);
  }
}

class GitlabProviderClient implements ProviderClient {
  constructor(
    private organizationId: string,
    private projectPath: string,
  ) {}

  async getPullRequestDiff(prNumber: number) {
    return gitlab.getPullRequestDiff(this.organizationId, this.projectPath, prNumber);
  }

  async createPullRequestComment(prNumber: number, body: string) {
    return gitlab.createPullRequestComment(this.organizationId, this.projectPath, prNumber, body);
  }

  async updatePullRequestComment(commentId: number, body: string, prNumber?: number) {
    if (!prNumber) {
      throw new Error("GitLab requires prNumber to update a note");
    }
    return gitlab.updatePullRequestComment(
      this.organizationId, this.projectPath, prNumber, commentId, body,
    );
  }

  async createPullRequestReview(
    prNumber: number,
    body: string,
    _event: "COMMENT" | "REQUEST_CHANGES" | "APPROVE",
    comments: ReviewComment[],
  ) {
    for (const comment of comments) {
      try {
        await gitlab.createInlineComment(
          this.organizationId,
          this.projectPath,
          prNumber,
          comment.path,
          comment.line,
          comment.body,
        );
      } catch (err) {
        console.error(`[gitlab] Failed to post inline comment on ${comment.path}:${comment.line}:`, err);
      }
    }

    if (body) {
      const commentId = await gitlab.createPullRequestComment(
        this.organizationId,
        this.projectPath,
        prNumber,
        body,
      );
      return commentId;
    }
    return 0;
  }

  async createCheckRun(): Promise<number | null> {
    return null;
  }

  async updateCheckRun(): Promise<void> {
    // No-op for GitLab
  }

  async getRepositoryTree(branch: string) {
    return gitlab.getRepositoryTree(this.organizationId, this.projectPath, branch);
  }

  async getFileContent(branch: string, filePath: string) {
    return gitlab.getFileContent(this.organizationId, this.projectPath, branch, filePath);
  }
}

/**
 * Create a provider client for a given repository.
 * Resolves the correct provider (GitHub, Bitbucket, GitLab) and returns a unified interface.
 */
export async function getProviderClient(repoId: string): Promise<ProviderClient> {
  const repo = await prisma.repository.findUniqueOrThrow({
    where: { id: repoId },
    select: {
      provider: true,
      fullName: true,
      installationId: true,
      organizationId: true,
      organization: {
        select: { githubInstallationId: true },
      },
    },
  });

  if (repo.provider === "bitbucket") {
    const [workspace, repoSlug] = repo.fullName.split("/");
    return new BitbucketProviderClient(repo.organizationId, workspace, repoSlug);
  }

  if (repo.provider === "gitlab") {
    return new GitlabProviderClient(repo.organizationId, repo.fullName);
  }

  // Default: GitHub
  const installationId = repo.installationId ?? repo.organization.githubInstallationId;
  if (!installationId) {
    throw new Error(`No GitHub installation for repo: ${repoId}`);
  }
  const [owner, repoName] = repo.fullName.split("/");
  return new GitHubProviderClient(installationId, owner, repoName);
}
