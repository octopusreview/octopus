import { reportBackgroundFailure } from "./background-failure";
import { AiProviderFailure, safeErrorDetails } from "./provider-failure";
import { cleanupForgejoConnectorRequests } from "./forgejo-connector";
import type { JobWithMetadata, PgBoss } from "pg-boss";
import { sendWelcomeEmail } from "./emails/welcome";
import { processReview } from "./reviewer";
import { createReviewExecutionWindow, isReviewCancelled } from "./review-capacity";
import {
  handleLargeReviewResult,
  type LargeReviewResultJob,
} from "./large-review-result";
import { processCommunityReview, type CommunityReviewJobData } from "./community-review";
import { enforceAuditLogRetention, enforceActivityEventRetention } from "./audit";
import { enforceWebhookDeliveryRetention } from "./webhook-tenant";
import { refreshReleaseCache } from "./releases";
import { renewDueSubscriptions } from "./subscription";
import { reconcileAutoReloadAttempts } from "./credits";
import { syncMarketingConversions } from "./marketing-outbox";
import { runOllamaPull } from "./ollama-admin";
import { reapStuckReviews } from "./reap-stuck-reviews";
import { discoverRepositories } from "./discover-repositories";
import { processRepositoryIndex, type RepositoryIndexJob } from "./repository-index-job";
import { dispatchDeferredIndexes } from "./github-deferred-index";
import { pruneExpiredIndexRateWindows } from "./github-index-rate-state";
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
  await boss.work("discover-models", { localConcurrency: 1 }, async (jobs) => {
    const { refreshModelDiscovery } = await import("./providers/model-discovery");
    for (const job of jobs) await refreshModelDiscovery(job.signal);
  });
  await boss.work("marketing-contexts", { localConcurrency: 1 }, async () => {
    try {
      const { activeTrackingConfig, captureMarketingContexts } = await import("./marketing-capture");
      const tracking = activeTrackingConfig();
      if (!tracking) return;
      const { getStripe } = await import("./stripe");
      const { marketingStripeReader } = await import("./marketing-stripe");
      await captureMarketingContexts(tracking, marketingStripeReader(getStripe()));
    } catch {
      throw new Error("Marketing context reconciliation failed; no billing state was changed");
    }
  });
  await boss.work("marketing-conversions", { localConcurrency: 1 }, async () => {
    try {
      await syncMarketingConversions();
    } catch {
      // SDK/DB error objects can contain request bodies or credentials.
      throw new Error("Marketing conversion sweep failed; inspect sanitized outbox status and configuration");
    }
  });

  await boss.work("index-repository", { localConcurrency: 1, includeMetadata: true }, async (jobs: JobWithMetadata<RepositoryIndexJob>[]) => {
    for (const job of jobs) {
      const retry = { retryCount: job.retryCount, retryLimit: job.retryLimit };
      try { await processRepositoryIndex(job.data, retry, job.id); }
      catch (error) {
        reportBackgroundFailure(error, { stage: "indexing", attemptId: job.id, repositoryId: job.data?.repositoryId, retry });
        throw error;
      }
    }
  });

  await boss.work<WelcomeEmailJob>("welcome-email", async (jobs) => {
    for (const job of jobs) {
      console.log(`[queue] Processing welcome-email for ${job.data.email}`);
      await sendWelcomeEmail(job.data);
    }
  });

  await boss.work(
    "process-review",
    { localConcurrency: config.reviewConcurrency, includeMetadata: true },
    async (jobs: JobWithMetadata<ProcessReviewJob>[]) => {
      for (const job of jobs) {
        console.log(`[queue] Processing review for PR ${job.data.pullRequestId}`);
        const executionWindow = createReviewExecutionWindow(job);
        try {
          await processReview(job.data.pullRequestId, executionWindow, job.retryCount);
        } catch (err) {
          reportBackgroundFailure(err, { stage: "review", pullRequestId: job.data.pullRequestId,
            attemptId: job.id, cancelled: isReviewCancelled(executionWindow), retry: { retryCount: job.retryCount, retryLimit: job.retryLimit } });
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
          console.error(`[queue] community-review failed for jobId=${job.data.jobId} (job ${job.id}):`, safeErrorDetails(err instanceof AiProviderFailure ? err.details : err));
          throw err;
        }
      }
    },
  );

  await boss.work("cleanup-forgejo-connector", async () => {
    await cleanupForgejoConnectorRequests();
  });

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

  // Daily subscription renewals — scheduled in instrumentation.ts via
  // boss.schedule() (cloud only). Idempotent: grants are keyed on the Stripe
  // PaymentIntent id, so a re-run can never double-grant a period.
  await boss.work("subscription-renewals", async (jobs) => {
    for (const job of jobs) {
      try {
        const r = await renewDueSubscriptions();
        console.log(
          `[queue] subscription-renewals ${job.id}: renewed=${r.renewed} canceled=${r.canceled} downgraded=${r.downgraded} failed=${r.failed}`,
        );
      } catch (err) {
        console.error(`[queue] subscription-renewals failed (job ${job.id}):`, err);
        throw err;
      }
    }
  });

  // Hosted auto-reload reconciliation — scheduled every minute. The durable
  // attempt lease and PI-keyed credit ledger make repeated runs race-safe.
  await boss.work("reconcile-auto-reloads", async (jobs) => {
    for (const job of jobs) {
      try {
        const result = await reconcileAutoReloadAttempts();
        if (result.scanned || result.failed) {
          console.log(
            `[queue] reconcile-auto-reloads ${job.id}: scanned=${result.scanned} attempted=${result.attempted} failed=${result.failed}`,
          );
        }
      } catch (err) {
        console.error(`[queue] reconcile-auto-reloads failed (job ${job.id}):`, err);
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

  // Daily signature-verified webhook-delivery retention. The delete is
  // idempotent, so concurrent workers remain safe.
  await boss.work("enforce-webhook-delivery-retention", async (jobs) => {
    for (const job of jobs) {
      try {
        const deleted = await enforceWebhookDeliveryRetention();
        console.log(
          `[queue] enforce-webhook-delivery-retention ${job.id}: deleted ${deleted} rows`,
        );
      } catch (err) {
        console.error(
          `[queue] enforce-webhook-delivery-retention failed (job ${job.id}):`,
          err,
        );
        throw err;
      }
    }
  });

  // Reap reviews orphaned mid-flight — scheduled every 5 min in
  // instrumentation.ts via boss.schedule(). Idempotent (status-guarded update),
  // so concurrent instances are harmless.
  await boss.work("reap-stuck-reviews", async (jobs) => {
    for (const job of jobs) {
      try {
        const { requeued, failed } = await reapStuckReviews();
        if (requeued || failed) {
          console.log(
            `[queue] reap-stuck-reviews ${job.id}: requeued=${requeued} failed=${failed}`,
          );
        }
      } catch (err) {
        console.error(`[queue] reap-stuck-reviews failed (job ${job.id}):`, err);
        throw err;
      }
      try { await dispatchDeferredIndexes(boss); await pruneExpiredIndexRateWindows(); }
      catch { console.error("[queue] GitHub indexing recovery sweep failed; the next sweep will retry"); }
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

  // Hourly repository discovery sweep — scheduled in instrumentation.ts.
  // Quiet when nothing changed, like the reaper above.
  await boss.work("discover-repositories", async (jobs) => {
    for (const job of jobs) {
      try {
        const r = await discoverRepositories();
        if (r.created || r.removed || r.failed || r.rateLimited) {
          console.log(
            `[queue] discover-repositories ${job.id}: orgs=${r.orgs} created=${r.created} removed=${r.removed} failed=${r.failed} rateLimited=${r.rateLimited}`,
          );
        }
      } catch (err) {
        console.error(`[queue] discover-repositories failed (job ${job.id}):`, err);
        throw err;
      }
    }
  });

  console.log("[queue] Workers registered: welcome-email, process-review, post-large-review-result, community-review, enforce-audit-retention, enforce-activity-retention, refresh-release-cache, reap-stuck-reviews, discover-repositories, subscription-renewals, reconcile-auto-reloads, pull-ollama-model");
}
