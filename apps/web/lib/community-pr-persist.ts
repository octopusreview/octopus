import { prisma } from "@octopus/db";
import type { InlineFinding } from "@/lib/review-dedup";

const SEVERITY_MAP: Record<string, string> = {
  "🔴": "critical",
  "🟠": "high",
  "🟡": "medium",
  "🔵": "low",
  "💡": "low",
};

export type CommunityPRPersistInput = {
  repositoryId: string;
  fullName: string;
  prNumber: number;
  prTitle?: string | null;
  prAuthor?: string | null;
  headSha?: string | null;
  summary: string;
  findings: InlineFinding[];
};

/**
 * Persist a completed community review as a PullRequest + ReviewIssue rows
 * so it shows up in the admin panel alongside App-webhook reviews.
 *
 * Idempotent on (repositoryId, number): re-running for the same PR replaces
 * the prior findings with the latest review's findings.
 */
export async function persistCommunityReviewToPR(input: CommunityPRPersistInput): Promise<void> {
  const {
    repositoryId,
    fullName,
    prNumber,
    prTitle,
    prAuthor,
    headSha,
    summary,
    findings,
  } = input;

  const url = `https://github.com/${fullName}/pull/${prNumber}`;

  const pr = await prisma.pullRequest.upsert({
    where: { repositoryId_number: { repositoryId, number: prNumber } },
    create: {
      repositoryId,
      number: prNumber,
      title: prTitle ?? `PR #${prNumber}`,
      url,
      author: prAuthor ?? "unknown",
      status: "completed",
      headSha: headSha ?? null,
      reviewBody: summary,
    },
    update: {
      title: prTitle ?? undefined,
      author: prAuthor ?? undefined,
      headSha: headSha ?? undefined,
      status: "completed",
      reviewBody: summary,
      errorMessage: null,
    },
  });

  await prisma.reviewIssue.deleteMany({ where: { pullRequestId: pr.id } });

  if (findings.length > 0) {
    await prisma.reviewIssue.createMany({
      data: findings.map((f) => ({
        pullRequestId: pr.id,
        title: f.title.replace(/^(CRITICAL|HIGH|MEDIUM|LOW|INFO)\s*—\s*/i, "").trim(),
        description: f.description || f.category,
        severity: SEVERITY_MAP[f.severity] ?? "medium",
        filePath: f.filePath || null,
        lineNumber: f.startLine || null,
        confidence: f.confidence ? String(f.confidence) : null,
      })),
    });
  }
}
