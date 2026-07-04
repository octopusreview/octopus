import { prisma, type Prisma } from "@octopus/db";
import type { InlineFinding } from "@/lib/review-dedup";
import { findingSignature, mergeFindingsBySignature, inheritReviewIssueTriage } from "@/lib/finding-merge";

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

  // Signature-matched findings inherit prior triage state; delete+create run
  // atomically so a mid-way failure can never wipe triage without replacement.
  const priorIssues = await prisma.reviewIssue.findMany({ where: { pullRequestId: pr.id } });
  const current: Prisma.ReviewIssueCreateManyInput[] = findings.map((f) => {
    const title = f.title.replace(/^(CRITICAL|HIGH|MEDIUM|LOW|INFO)\s*—\s*/i, "").trim();
    return {
      pullRequestId: pr.id,
      title,
      description: f.description || f.category,
      severity: SEVERITY_MAP[f.severity] ?? "medium",
      filePath: f.filePath || null,
      lineNumber: f.startLine || null,
      confidence: f.confidence ? String(f.confidence) : null,
      signature: findingSignature({ filePath: f.filePath || "", category: f.category, title }),
    };
  });
  const { merged } = mergeFindingsBySignature<Prisma.ReviewIssueCreateManyInput>({
    prior: priorIssues,
    current,
    inherit: inheritReviewIssueTriage,
  });
  await prisma.$transaction([
    prisma.reviewIssue.deleteMany({ where: { pullRequestId: pr.id } }),
    ...(merged.length > 0 ? [prisma.reviewIssue.createMany({ data: merged })] : []),
  ]);
}
