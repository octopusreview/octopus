import type { PgBoss } from "pg-boss";
import { sendWelcomeEmail } from "./emails/welcome";

export interface WelcomeEmailJob {
  userId: string;
  email: string;
  name: string;
}

export async function registerWorkers(boss: PgBoss): Promise<void> {
  await boss.work<WelcomeEmailJob>("welcome-email", async (jobs) => {
    for (const job of jobs) {
      console.log(`[queue] Processing welcome-email for ${job.data.email}`);
      await sendWelcomeEmail(job.data);
    }
  });

  console.log("[queue] Workers registered: welcome-email");
}
