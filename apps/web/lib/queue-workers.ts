import type { PgBoss } from "pg-boss";
import { sendWelcomeEmail } from "./emails/welcome";
import { processReview } from "./reviewer";
import {
  handleLargeReviewResult,
  type LargeReviewResultJob,
} from "./large-review-result";
import { processCommunityReview, type CommunityReviewJobData } from "./community-review";
import { enforceAuditLogRetention } from "./audit";
import { fetchLatestRelease, writeReleaseCache } from "./releases";
import type { QueueConfig } from "./queue";

export interface WelcomeEmailJob {
  userId: string;
  email: string;
  name: string;
}

export interface ProcessReviewJob {
  pullRequestId: string;
}

export async function registerWorkers(boss: PgBoss, config: QueueConfig): Promise<void> {
  await boss.work<WelcomeEmailJob>("welcome-email", async (jobs) => {
    for (const job of jobs) {
      console.log(`[queue] Processing welcome-email for ${job.data.email}`);
      await sendWelcomeEmail(job.data);
    }
  });

  await boss.work<ProcessReviewJob>(
    "process-review",
    { localConcurrency: config.reviewConcurrency },
    async (jobs) => {
      for (const job of jobs) {
        console.log(`[queue] Processing review for PR ${job.data.pullRequestId}`);
        try {
          await processReview(job.data.pullRequestId);
        } catch (err) {
          console.error(`[queue] Review failed for PR ${job.data.pullRequestId} (job ${job.id}):`, err);
          throw err;
        }
      }
    },
  );

  // Handle results from internal-cli (large PRs reviewed via clone + claude-cli)
  await boss.work<LargeReviewResultJob>(
    "post-large-review-result",
    { localConcurrency: config.reviewConcurrency },
    async (jobs) => {
      for (const job of jobs) {
        console.log(`[queue] Posting large review result for PR ${job.data.pullRequestId}`);
        try {
          await handleLargeReviewResult(job.data);
        } catch (err) {
          console.error(`[queue] Large review post failed for PR ${job.data.pullRequestId} (job ${job.id}):`, err);
          throw err;
        }
      }
    },
  );

  await boss.work<CommunityReviewJobData>(
    "community-review",
    { localConcurrency: config.reviewConcurrency },
    async (jobs) => {
      for (const job of jobs) {
        console.log(`[queue] Processing community-review jobId=${job.data.jobId}`);
        try {
          await processCommunityReview(job.data.jobId);
        } catch (err) {
          console.error(`[queue] community-review failed for jobId=${job.data.jobId} (job ${job.id}):`, err);
          throw err;
        }
      }
    },
  );

  // Daily audit-log retention job. Runs on a per-instance cron via boss.schedule()
  // in instrumentation.ts; the worker registered here is what actually executes
  // a triggered run. Idempotent — multiple instances racing on the same row are
  // harmless thanks to deleteMany's WHERE clause.
  await boss.work("enforce-audit-retention", async (jobs) => {
    for (const job of jobs) {
      try {
        const deleted = await enforceAuditLogRetention();
        console.log(`[queue] enforce-audit-retention ${job.id}: deleted ${deleted} rows`);
      } catch (err) {
        console.error(`[queue] enforce-audit-retention failed (job ${job.id}):`, err);
        throw err;
      }
    }
  });

  // Daily release-cache refresh. /api/releases/latest reads
  // SystemConfig.latestRelease; this worker keeps it warm so the self-hosted
  // Updates page is a sub-millisecond local lookup instead of a rate-limited
  // GitHub API call on every render. Fetch + write live in lib/releases.ts —
  // single source of truth, no duplicate upsert path.
  await boss.work("refresh-release-cache", async (jobs) => {
    for (const job of jobs) {
      try {
        const fresh = await fetchLatestRelease();
        if (!fresh) {
          console.warn(`[queue] refresh-release-cache ${job.id}: fetch returned null`);
          continue;
        }
        await writeReleaseCache(fresh);
        console.log(`[queue] refresh-release-cache ${job.id}: cached ${fresh.tagName}`);
      } catch (err) {
        console.error(`[queue] refresh-release-cache failed (job ${job.id}):`, err);
        throw err;
      }
    }
  });

  console.log("[queue] Workers registered: welcome-email, process-review, post-large-review-result, community-review, enforce-audit-retention, refresh-release-cache");
}
