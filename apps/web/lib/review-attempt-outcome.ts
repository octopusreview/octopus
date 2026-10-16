import "server-only";
import { prisma, Prisma } from "@octopus/db";
import type { ReviewCoverage } from "./review-coverage";

export type ReviewKind = "substantive" | "partial" | "incomplete" | "not_required" | "empty" | "not_assessed" | "unknown";
export type ReviewOutcome = "published" | "partially_published" | "uncertain" | "failed" | "superseded";
export type ReviewOutcomeKey = { organizationId: string; repositoryId: string; pullRequestId: string; requestVersion: number };

export function reviewKind(coverage?: ReviewCoverage, large = false): ReviewKind {
  if (large) return "unknown";
  if (!coverage) return "not_assessed";
  if (coverage.complete && coverage.inventoryComplete && coverage.files.length === 0) return "empty";
  if (coverage.complete && coverage.files.length > 0 && coverage.files.every(f => f.state === "excluded")) return "not_required";
  if (!coverage.assessment) return "not_assessed";
  if (coverage.assessment.state === "completed") return coverage.complete ? "substantive" : "partial";
  return "incomplete";
}

/** Only explicit HTTP rejections prove failure. Other errors remain uncertain. */
export function mainCommentFailure(error: unknown): "failed" | "uncertain" {
  if (!(error instanceof Error)) return "uncertain";
  const status = "status" in error ? Number(error.status) : Number(error.message.match(/^Failed to (?:create|update) (?:PR comment|GitLab MR note|Bitbucket PR comment): (\d{3})(?:\s|$)/)?.[1]);
  return [400, 401, 403, 404, 405, 410, 413, 415, 422, 429].includes(status) ? "failed" : "uncertain";
}

// Keep telemetry contention and outages out of the review's critical path.
// Never include the exception: provider/SQL messages may contain private data.
async function bestEffort(write: (tx: Prisma.TransactionClient) => Promise<unknown>, client?: Prisma.TransactionClient): Promise<void> {
  if (client) {
    // A missing table or timeout must not poison the caller's admission/claim.
    try {
      await client.$executeRawUnsafe("SAVEPOINT review_outcome_write");
      const [settings] = await client.$queryRaw<Array<{ lock: string; statement: string }>>`SELECT current_setting('lock_timeout') AS lock, current_setting('statement_timeout') AS statement`;
      try {
        await client.$executeRawUnsafe("SET LOCAL lock_timeout = '5ms'");
        await client.$executeRawUnsafe("SET LOCAL statement_timeout = '100ms'");
        await write(client);
        await client.$queryRaw`SELECT set_config('lock_timeout', ${settings.lock}, true), set_config('statement_timeout', ${settings.statement}, true)`;
      } catch {
        await client.$executeRawUnsafe("ROLLBACK TO SAVEPOINT review_outcome_write");
        console.warn("[review-outcome] recording unavailable");
      }
      await client.$executeRawUnsafe("RELEASE SAVEPOINT review_outcome_write");
    } catch {
      console.warn("[review-outcome] recording unavailable");
    }
    return;
  }
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5ms'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '100ms'");
      await write(tx);
    }, { maxWait: 10, timeout: 200 });
  } catch {
    console.warn("[review-outcome] recording unavailable");
  }
}

export async function startReviewOutcome(key: ReviewOutcomeKey, at: Date, client?: Prisma.TransactionClient): Promise<void> {
  await bestEffort(tx => tx.$executeRaw`
    INSERT INTO review_attempt_outcomes
      ("organizationId", "repositoryId", "pullRequestId", "requestVersion", kind, tries, "firstTriedAt")
    VALUES (${key.organizationId}, ${key.repositoryId}, ${key.pullRequestId}, ${key.requestVersion}, 'not_assessed', 1, ${at}::timestamp)
    ON CONFLICT ("pullRequestId", "requestVersion") DO UPDATE
      SET tries = review_attempt_outcomes.tries + 1
      WHERE review_attempt_outcomes.outcome IS DISTINCT FROM 'published'
  `, client);
}

export async function finishReviewOutcome(key: ReviewOutcomeKey, kind: ReviewKind, outcome: ReviewOutcome, archiveId: string | null, at: Date): Promise<void> {
  await bestEffort(tx => tx.$executeRaw`
    UPDATE review_attempt_outcomes SET kind = ${kind}, outcome = ${outcome},
      "resultArchiveId" = ${archiveId},
      "finishedAt" = CASE WHEN outcome IS DISTINCT FROM ${outcome} THEN ${at}::timestamp ELSE "finishedAt" END,
      "publishedAt" = CASE WHEN ${outcome} = 'published' THEN ${at}::timestamp ELSE "publishedAt" END
    WHERE "pullRequestId" = ${key.pullRequestId} AND "requestVersion" = ${key.requestVersion}
      AND outcome IS DISTINCT FROM 'published'
  `);
}

export async function supersedeReviewOutcomes(pullRequestId: string, version: number | null, at: Date): Promise<void> {
  await bestEffort(tx => tx.$executeRaw`
    UPDATE review_attempt_outcomes SET outcome = 'superseded', "finishedAt" = ${at}::timestamp
    WHERE "pullRequestId" = ${pullRequestId} AND "requestVersion" < COALESCE(${version}::integer,
        (SELECT "reviewRequestVersion" FROM pull_requests WHERE id = ${pullRequestId}))
      AND outcome IS DISTINCT FROM 'published' AND outcome IS DISTINCT FROM 'superseded'
  `);
}

/** Call only after the admission's transaction has committed. Never await telemetry. */
export function recordReviewAdmissionAfterCommit(pullRequestId: string, version: number | null): void {
  void supersedeReviewOutcomes(pullRequestId, version, new Date()).catch(() => {
    console.warn("[review-outcome] recording unavailable");
  });
}

export async function deferReviewOutcome(key: ReviewOutcomeKey): Promise<void> {
  await bestEffort(async tx => {
    await tx.$executeRaw`UPDATE review_attempt_outcomes SET tries = tries - 1
      WHERE "pullRequestId" = ${key.pullRequestId} AND "requestVersion" = ${key.requestVersion}
        AND outcome IS DISTINCT FROM 'published' AND tries > 0`;
    await tx.$executeRaw`DELETE FROM review_attempt_outcomes
      WHERE "pullRequestId" = ${key.pullRequestId} AND "requestVersion" = ${key.requestVersion} AND tries = 0 AND outcome IS NULL`;
  });
}

/** Per-run observation; it never catches or changes the provider operation. */
export class ReviewOutcomeRecorder {
  private main: "not_started" | "published" | "failed" | "uncertain" | "superseded" = "not_started";
  private inline = false;
  private publication?: { kind: ReviewKind; archiveId: string | null };
  private coverage?: ReviewCoverage;
  private archiveId: string | null = null;
  constructor(readonly key: ReviewOutcomeKey, private readonly large = false) {}
  assessment(coverage: ReviewCoverage | undefined, archiveId: string | null) {
    this.coverage = coverage;
    this.archiveId = archiveId;
  }
  mainPosted = () => {
    this.main = "published";
    this.publication ??= { kind: reviewKind(this.coverage, this.large), archiveId: this.archiveId };
  };
  inlinePosted() { this.inline = true; }
  async publish<T>(operation: () => Promise<T>): Promise<T> {
    try {
      const result = await operation();
      if (result !== null) this.mainPosted();
      else if (this.main !== "published") this.main = "superseded";
      return result;
    } catch (error) {
      if (this.main !== "published") this.main = mainCommentFailure(error);
      throw error;
    } finally {
      if (this.main !== "not_started") await this.finish(new Date());
    }
  }
  async finish(at: Date) {
    const outcome = this.main === "published" ? "published" : this.main === "superseded" ? "superseded" : this.main === "uncertain" ? "uncertain"
      : this.inline ? "partially_published" : "failed";
    await finishReviewOutcome(this.key, this.publication?.kind ?? reviewKind(this.coverage, this.large), outcome, this.publication ? this.publication.archiveId : this.archiveId, at);
  }
}
