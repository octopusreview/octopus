import type { PgBoss } from "pg-boss";
import { sendWelcomeEmail } from "./emails/welcome";
import { processReview } from "./reviewer";
import {
  handleLargeReviewResult,
  type LargeReviewResultJob,
} from "./large-review-result";
import { processCommunityReview, type CommunityReviewJobData } from "./community-review";
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

  console.log("[queue] Workers registered: welcome-email, process-review, post-large-review-result, community-review");
}
