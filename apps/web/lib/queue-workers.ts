import type { PgBoss } from "pg-boss";
import { sendWelcomeEmail } from "./emails/welcome";
import { processReview } from "./reviewer";
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
        await processReview(job.data.pullRequestId);
      }
    },
  );

  console.log("[queue] Workers registered: welcome-email, process-review");
}
