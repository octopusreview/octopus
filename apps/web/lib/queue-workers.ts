import type { PgBoss } from "pg-boss";
import { sendWelcomeEmail } from "./emails/welcome";
import { processReview } from "./reviewer";
import {
  handleLargeReviewResult,
  type LargeReviewResultJob,
} from "./large-review-result";
import { processCommunityReview, type CommunityReviewJobData } from "./community-review";
import { enforceAuditLogRetention, enforceActivityEventRetention } from "./audit";
import { refreshReleaseCache } from "./releases";
import { runOllamaPull } from "./ollama-admin";
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

  // Daily audit-log retention job — scheduled in instrumentation.ts via
  // boss.schedule(); the worker registered here executes a triggered run.
  // Idempotent: deleteMany's WHERE clause makes concurrent instances harmless.
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

  // Daily ActivityEvent retention job — scheduled in instrumentation.ts via
  // boss.schedule(); idempotent deleteMany makes concurrent instances harmless.
  await boss.work("enforce-activity-retention", async (jobs) => {
    for (const job of jobs) {
      try {
        const deleted = await enforceActivityEventRetention();
        console.log(`[queue] enforce-activity-retention ${job.id}: deleted ${deleted} rows`);
      } catch (err) {
        console.error(`[queue] enforce-activity-retention failed (job ${job.id}):`, err);
        throw err;
      }
    }
  });

  // Daily release-cache refresh (self-hosted) — scheduled in instrumentation.ts
  // via boss.schedule(). Keeps SystemConfig.latestRelease warm so the update
  // panel/route serves a fresh answer without a lazy cache miss. Idempotent:
  // a single upsert row, safe to run repeatedly.
  await boss.work("refresh-release-cache", async (jobs) => {
    for (const job of jobs) {
      try {
        const release = await refreshReleaseCache();
        console.log(
          `[queue] refresh-release-cache ${job.id}: ${release ? release.tagName : "fetch failed, cache unchanged"}`,
        );
      } catch (err) {
        console.error(`[queue] refresh-release-cache failed (job ${job.id}):`, err);
        throw err;
      }
    }
  });

  // Admin-triggered Ollama model download (self-hosted). runOllamaPull is
  // self-contained: it records progress/failure in the OllamaModelPull row and
  // never throws, so a failed download doesn't trip pg-boss retries.
  await boss.work<{ model: string }>("pull-ollama-model", async (jobs) => {
    for (const job of jobs) {
      console.log(`[queue] pull-ollama-model ${job.id}: ${job.data.model}`);
      await runOllamaPull(job.data.model);
    }
  });

  console.log("[queue] Workers registered: welcome-email, process-review, post-large-review-result, community-review, enforce-audit-retention, enforce-activity-retention, refresh-release-cache, pull-ollama-model");
}
